import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireCapability } from "@/lib/auth";
import { formatDate, formatYen, statusLabel } from "@/lib/format";
import { syncStripePayments } from "@/lib/stripeSync";
import { resolveMatchingIds } from "@/lib/adminSearch";
import { composeFullName } from "@/lib/registration";
import PaymentRow from "./PaymentRow";
import SyncButton from "./SyncButton";

/**
 * 顧客名の表示を解決する。full_name は2段階登録で姓名から合成する項目のため、
 * 空文字になっているケースがある（`??` は空文字を握りつぶさないので blank 表示の
 * 原因になる）。full_name → 姓+名 → Stripe 上の名前 の順に、空でない値を採用する。
 */
function resolveCustomerName(p: any): string {
  const full = (p.customer?.full_name as string | null)?.trim();
  if (full) return full;
  const composed = composeFullName(p.customer?.last_name, p.customer?.first_name);
  if (composed) return composed;
  return (p.raw?.stripe_name as string | null)?.trim() ?? "";
}

function resolveCustomerEmail(p: any): string {
  const email = (p.customer?.email as string | null)?.trim();
  if (email) return email;
  return (p.raw?.stripe_email as string | null)?.trim() ?? "";
}

const PAGE_SIZE = 20;

// Stripe-style status summary chips.
const STATUS_CHIPS: { key: string; label: string }[] = [
  { key: "", label: "すべて" },
  { key: "succeeded", label: "成功" },
  { key: "refunded", label: "返金済み" },
  { key: "failed", label: "失敗" },
  { key: "pending", label: "未確定" },
];

function paymentMethodLabel(raw: any): string {
  const brand = raw?.brand as string | null;
  const last4 = raw?.last4 as string | null;
  if (!brand && !last4) return "—";
  const b = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : "カード";
  return last4 ? `${b} ••••${last4}` : b;
}

/** Stripe の汎用説明文（ご利用ありがとうございました等）を kind ベースの表示に変換 */
function resolveDescription(raw: any, kind: string): string {
  const desc = (raw?.description as string | null)?.trim() ?? "";
  // Stripe が自動付与する日本語汎用テキストは意味がないので置換する
  const isGeneric =
    !desc ||
    /^ご利用ありがとうございました/.test(desc) ||
    /^Thank you/.test(desc) ||
    /^Subscription (update|creation)/.test(desc);
  if (isGeneric) {
    return kind === "subscription" ? "定期支援" : kind === "one_time" ? "単発寄付" : "—";
  }
  return desc;
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams?: { status?: string; q?: string; page?: string };
}) {
  await requireCapability("payments.manage");
  // Keep current with Stripe on each load (incremental, best-effort).
  await syncStripePayments({}).catch(() => {});
  // Admin-only page (gated above): use the service-role client so the status
  // counts and ordering are exact and fast — RLS per-row policy evaluation on
  // 10k+ rows makes filtered COUNT queries time out (→ null → 0).
  const supabase = createSupabaseAdminClient();

  const status = searchParams?.status ?? "";
  const q = (searchParams?.q ?? "").trim();
  const page = Math.max(1, Number(searchParams?.page ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;

  // Server-side search across Stripe IDs + the payer email/name stored on the
  // row (raw), PLUS the linked customer's name/email. The 顧客 column shows the
  // linked customer's full_name, which is often empty/different in raw, so we
  // resolve matching customer ids and include them — letting search work by
  // customer name as displayed.
  const safeQ = q.replace(/[%*,()]/g, "");
  let orFilter = "";
  if (safeQ) {
    const parts = [
      `stripe_charge_id.ilike.*${safeQ}*`,
      `stripe_payment_intent_id.ilike.*${safeQ}*`,
      `stripe_invoice_id.ilike.*${safeQ}*`,
      `raw->>stripe_email.ilike.*${safeQ}*`,
      `raw->>stripe_name.ilike.*${safeQ}*`,
    ];
    const custIds = await resolveMatchingIds(supabase, "customers", ["full_name", "email"], q);
    if (custIds.length) parts.push(`customer_id.in.(${custIds.join(",")})`);
    orFilter = parts.join(",");
  }

  const applyFilters = (qy: any, statusVal: string) => {
    if (statusVal) qy = qy.eq("status", statusVal);
    if (orFilter) qy = qy.or(orFilter);
    return qy;
  };

  // Status counts (respect the search box).
  const countFor = (statusVal: string) =>
    applyFilters(supabase.from("payments").select("*", { count: "exact", head: true }), statusVal);
  const [allC, okC, refC, failC, pendC] = await Promise.all([
    countFor(""),
    countFor("succeeded"),
    countFor("refunded"),
    countFor("failed"),
    countFor("pending"),
  ]);
  const counts: Record<string, number> = {
    "": allC.count ?? 0,
    succeeded: okC.count ?? 0,
    refunded: refC.count ?? 0,
    failed: failC.count ?? 0,
    pending: pendC.count ?? 0,
  };

  // Page of rows.
  const { data, error } = await applyFilters(
    supabase
      .from("payments")
      .select("*, customer:customers(full_name, last_name, first_name, email)")
      .order("occurred_at", { ascending: false }),
    status,
  ).range(from, from + PAGE_SIZE - 1);
  const rows = (data as any[]) ?? [];

  const totalCount = counts[status] ?? counts[""] ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const linkFor = (opts: { status?: string; page?: number }) => {
    const sp = new URLSearchParams();
    const s = opts.status ?? status;
    if (s) sp.set("status", s);
    if (q) sp.set("q", q);
    if (opts.page && opts.page > 1) sp.set("page", String(opts.page));
    const str = sp.toString();
    return `/admin/payments${str ? `?${str}` : ""}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">決済履歴</h1>
        <SyncButton />
      </div>

      {/* Stripe-style status summary chips */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {STATUS_CHIPS.map((c) => {
          const active = status === c.key;
          return (
            <Link
              key={c.key || "all"}
              href={linkFor({ status: c.key, page: 1 })}
              className={`card !p-3 transition-colors ${
                active ? "ring-2 ring-brand bg-brand-50/40" : "hover:bg-surface-soft"
              }`}
            >
              <p className="text-xs text-ink-soft">{c.label}</p>
              <p className="text-xl font-bold tabular-nums">{(counts[c.key] ?? 0).toLocaleString()}</p>
            </Link>
          );
        })}
      </div>

      <form className="card flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="label">顧客 / メール / Stripe ID</label>
          <input name="q" className="input" defaultValue={q} placeholder="検索..." />
        </div>
        {status && <input type="hidden" name="status" value={status} />}
        <button className="btn-primary">絞り込む</button>
        {(q || status) && (
          <Link className="btn-ghost" href="/admin/payments">
            リセット
          </Link>
        )}
      </form>

      {error && <div className="card text-danger text-sm">{error.message}</div>}

      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th>金額</th>
              <th>決済手段</th>
              <th>説明</th>
              <th>顧客</th>
              <th>日付</th>
              <th>返金日</th>
              <th>支払い拒否の理由</th>
              <th>Stripe</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p: any) => (
              <PaymentRow
                key={p.id}
                payment={{
                  id: p.id,
                  customer_id: p.customer_id,
                  customer_name: resolveCustomerName(p),
                  customer_email: resolveCustomerEmail(p),
                  amount: Number(p.amount ?? 0),
                  amount_label: formatYen(p.amount),
                  currency: (p.currency ?? "jpy").toUpperCase(),
                  payment_method: paymentMethodLabel(p.raw),
                  description: resolveDescription(p.raw, p.kind ?? ""),
                  status: p.status,
                  status_label: statusLabel(p.status),
                  failure_reason: p.failure_reason ?? "",
                  occurred_at: formatDate(p.occurred_at, true),
                  refund_date: p.raw?.refunded_at ? formatDate(p.raw.refunded_at) : "",
                  stripe_invoice_id: p.stripe_invoice_id ?? "",
                  stripe_payment_intent_id: p.stripe_payment_intent_id ?? "",
                  stripe_charge_id: p.stripe_charge_id ?? "",
                }}
              />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-6 text-ink-mute">
                  該当する決済がありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Compact pagination (10k+ rows → can't render every page button) */}
      <div className="flex items-center justify-center gap-2 text-sm">
        <Link
          href={linkFor({ page: 1 })}
          className={`btn-ghost !py-1.5 !px-3 ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}
        >
          « 最初
        </Link>
        <Link
          href={linkFor({ page: Math.max(1, page - 1) })}
          className={`btn-ghost !py-1.5 !px-3 ${page <= 1 ? "pointer-events-none opacity-40" : ""}`}
        >
          ‹ 前へ
        </Link>
        <span className="text-ink-soft tabular-nums px-2">
          {page} / {totalPages} ページ（全 {totalCount.toLocaleString()} 件）
        </span>
        <Link
          href={linkFor({ page: Math.min(totalPages, page + 1) })}
          className={`btn-ghost !py-1.5 !px-3 ${page >= totalPages ? "pointer-events-none opacity-40" : ""}`}
        >
          次へ ›
        </Link>
        <Link
          href={linkFor({ page: totalPages })}
          className={`btn-ghost !py-1.5 !px-3 ${page >= totalPages ? "pointer-events-none opacity-40" : ""}`}
        >
          最後 »
        </Link>
      </div>
    </div>
  );
}
