import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDate, formatYen } from "@/lib/format";
import { syncStripePayments } from "@/lib/stripeSync";
import { reconcileSubscriptionStatuses } from "@/lib/stripeReconcile";
import { buildRevenueSeries, type RawPayment } from "@/lib/revenueSeries";
import { currentYearMonth, monthStart, stripeReceipts, type PaymentRow } from "@/lib/monthlyReport";
import { HIDDEN_ACCOUNT_EMAILS } from "@/lib/hiddenAccounts";
import { CANONICAL_PAYMENTS_FILTER } from "@/lib/paymentRows";
import RevenueChart from "./RevenueChart";
import horseImage from "@/assets/images/horse.png";
import OpsSignals from "./OpsSignals";

// 収益推移チャートは年・月・週・日で切替表示するため、十分に長い期間
// （直近 5 年）の成功決済を取得する。1000 行の上限を超える可能性があるので
// ページングして全件取得する。
//
// チャートは Stripe の売上（決済された額そのまま。返金・手数料を引く前）を、Stripe の支払い 1 件ごとに数える。
// 同じ Stripe の決済が Webhook と Stripe 同期の2行で入るため、行をそのまま足すと二重になる
// （2026-10 に Stripe と照合：10月は Stripe ¥418,400 に対し、行の合計は ¥806,600）。
// 後から返金した決済も、Stripe と同じく決済された日の売上に入る。銀行振込の寄付は Stripe を通らないので入らない。
async function fetchSucceededPayments(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  sinceISO: string,
): Promise<RawPayment[]> {
  const pageSize = 1000;
  const rows: PaymentRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("payments")
      .select("occurred_at, amount, status, kind, stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id")
      .in("status", ["succeeded", "refunded"])
      .gte("occurred_at", sinceISO)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error || !data || data.length === 0) break;
    for (const row of data) {
      rows.push({
        amount: row.amount,
        status: row.status,
        kind: row.kind,
        occurred_at: row.occurred_at,
        contract_id: null,
        invoice_id: row.stripe_invoice_id,
        payment_intent_id: row.stripe_payment_intent_id,
        charge_id: row.stripe_charge_id,
      });
    }
    if (data.length < pageSize) break;
  }
  return stripeReceipts({ payments: rows, contracts: [], donations: [] }).map((receipt) => ({
    occurred_at: new Date(receipt.at).toISOString(),
    amount: receipt.amount,
  }));
}

export default async function AdminDashboardPage() {
  // Reflect the latest Stripe payments on the dashboard (incremental,
  // best-effort — never blocks the page if Stripe is slow/unreachable).
  await syncStripePayments({}).catch(() => {});
  // 決済完了済みなのに incomplete のまま固着した支援契約を Stripe の実状態へ
  // 自己修復（Webhook 取りこぼし対策）。incomplete/past_due だけを対象に
  // するため軽量。失敗してもページ表示は止めない。
  await reconcileSubscriptionStatuses({ onlyPending: true }).catch(() => {});
  const supabase = createSupabaseServerClient();

  const fiveYearsAgo = new Date();
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
  const now = new Date();
  const [year, month] = currentYearMonth(now).split("-").map(Number);
  const monthStartIso = monthStart(year, month).toISOString();
  const previousMonthIso = (month === 1 ? monthStart(year - 1, 12) : monthStart(year, month - 1)).toISOString();

  const [
    { count: customersTotalRaw },
    { count: hiddenCustomers },
    { count: pastDueCount },
    { count: activeContracts },
    { count: canceledContracts },
    { data: recentPayments },
    revenuePayments,
    { data: recentSupports },
    { data: upcomingEvents },
    { count: joinedThisMonth },
    { count: contractsStartedThisMonth },
    { count: bookingsLastMonth },
    { count: bookingsThisMonth },
    { data: pastDueRows },
  ] = await Promise.all([
    supabase.from("customers").select("*", { count: "exact", head: true }),
    // 内部テスト用アカウント分を会員数から差し引くためのカウント。
    supabase
      .from("customers")
      .select("*", { count: "exact", head: true })
      .in("email", HIDDEN_ACCOUNT_EMAILS as string[]),
    supabase.from("contracts").select("*", { count: "exact", head: true }).eq("status", "past_due"),
    supabase.from("contracts").select("*", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("contracts").select("*", { count: "exact", head: true }).eq("status", "canceled"),
    supabase
      .from("payments")
      .select("*, customer:customers(full_name,email)")
      // Webhook の控えの行は出さない（同じ決済が2行になる）。
      .or(CANONICAL_PAYMENTS_FILTER)
      .order("occurred_at", { ascending: false })
      .limit(5),
    fetchSucceededPayments(supabase, fiveYearsAgo.toISOString()),
    supabase
      .from("support_subscriptions")
      .select("*, horse:horses(name, image_url), customer:customers(full_name)")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("events")
      .select("*")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(5),
    supabase
      .from("customers")
      .select("email", { count: "exact", head: true })
      .or(`joined_at.gte."${monthStartIso}",and(joined_at.is.null,created_at.gte."${monthStartIso}")`)
      .not("email", "in", `(${HIDDEN_ACCOUNT_EMAILS.join(",")})`),
    supabase
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .gte("started_at", monthStartIso),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .gte("booked_at", previousMonthIso)
      .lt("booked_at", monthStartIso)
      .or("status.is.null,status.neq.canceled"),
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .gte("booked_at", monthStartIso)
      .or("status.is.null,status.neq.canceled"),
    supabase.from("contracts").select("customer_id, started_at").eq("status", "past_due"),
  ]);

  // 会員数は内部テスト用アカウントを除いた数を表示する（顧客一覧と一致）。
  const customersTotal = Math.max(0, (customersTotalRaw ?? 0) - (hiddenCustomers ?? 0));
  const membersAdded = joinedThisMonth ?? 0;
  const contractsAdded = contractsStartedThisMonth ?? 0;

  const failingRows = pastDueRows ?? [];
  const failingIds = [...new Set(failingRows.map((row) => row.customer_id).filter((id): id is string => !!id))];
  const failurePayments: { customer_id: string | null; occurred_at: string }[] = [];
  if (failingIds.length > 0) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("payments")
        .select("customer_id, occurred_at")
        .eq("status", "failed")
        .in("customer_id", failingIds)
        .order("id")
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      failurePayments.push(...data);
      if (data.length < 1000) break;
    }
  }
  const failureTiming = new Map<string, { before: boolean; during: boolean }>();
  for (const payment of failurePayments) {
    if (!payment.customer_id) continue;
    const timing = failureTiming.get(payment.customer_id) ?? { before: false, during: false };
    if (payment.occurred_at < monthStartIso) timing.before = true;
    else timing.during = true;
    failureTiming.set(payment.customer_id, timing);
  }
  const failuresAdded = failingRows.filter((row) => {
    const timing = row.customer_id ? failureTiming.get(row.customer_id) : undefined;
    if (timing?.before) return false;
    return !!timing?.during || (row.started_at ?? "") >= monthStartIso;
  }).length;
  const failuresBefore = failingRows.length - failuresAdded;

  // ── Revenue chart series (day / week / month / year) ──
  const revenueSeries = buildRevenueSeries(revenuePayments);

  // ── Donut chart for contract status ──
  const total = (activeContracts ?? 0) + (pastDueCount ?? 0) + (canceledContracts ?? 0);
  const C = 2 * Math.PI * 14; // circumference ≈ 87.96
  const activeLen = total > 0 ? ((activeContracts ?? 0) / total) * C : 0;
  const failedLen = total > 0 ? ((pastDueCount ?? 0) / total) * C : 0;
  const canceledLen = total > 0 ? ((canceledContracts ?? 0) / total) * C : 0;
  const activeOffset = C / 4; // start at top

  const cards = [
    {
      label: "会員数",
      previous: Math.max(0, customersTotal - membersAdded),
      added: membersAdded,
      href: "/admin/customers",
      icon: "https://api.iconify.design/fluent-emoji-flat/bust-in-silhouette.svg",
      baseText: "先月までの登録",
      addedText: "今月の新規",
      plusClass: "text-emerald-600",
      accentBar: "from-emerald-400 to-emerald-600",
      iconBg: "bg-emerald-50",
    },
    {
      label: "継続契約",
      previous: Math.max(0, (activeContracts ?? 0) - contractsAdded),
      added: contractsAdded,
      href: "/admin/contracts",
      icon: "https://api.iconify.design/fluent-emoji-flat/page-facing-up.svg",
      baseText: "先月までに開始",
      addedText: "今月の開始",
      plusClass: "text-sky-600",
      accentBar: "from-sky-400 to-sky-600",
      iconBg: "bg-sky-50",
    },
    {
      label: "決済失敗",
      previous: failuresBefore,
      added: failuresAdded,
      warn: (pastDueCount ?? 0) > 0,
      href: "/admin/payments?status=failed",
      icon: "https://api.iconify.design/fluent-emoji-flat/warning.svg",
      baseText: "先月までの失敗",
      addedText: "今月の新規",
      plusClass: "text-amber-600",
      accentBar: "from-amber-400 to-amber-600",
      iconBg: "bg-amber-50",
    },
    {
      label: "本日の予約",
      previous: bookingsLastMonth ?? 0,
      added: bookingsThisMonth ?? 0,
      href: "/admin/bookings",
      icon: "https://api.iconify.design/fluent-emoji-flat/spiral-calendar.svg",
      baseText: "先月の予約",
      addedText: "今月の予約",
      plusClass: "text-violet-600",
      accentBar: "from-violet-400 to-violet-600",
      iconBg: "bg-violet-50",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold">ダッシュボード</h1>
        <p className="text-xs text-ink-mute">{new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" })}</p>
      </div>

      <Suspense fallback={null}>
        <OpsSignals />
      </Suspense>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => {
          const inner = (
            <>
              {/* 上部アクセントバー */}
              <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${c.accentBar}`} />
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold text-ink-mute mb-1 tracking-wide">{c.label}</p>
                  <p className="text-2xl leading-none font-bold tabular-nums">
                    <span className={c.warn ? "text-danger" : "text-ink"}>{c.previous.toLocaleString("ja-JP")}</span>
                    <span className={`ml-1.5 text-lg ${c.plusClass}`}>+{c.added.toLocaleString("ja-JP")}</span>
                  </p>
                  <p className="text-[11px] mt-1.5 leading-snug">
                    <span className={c.warn ? "text-danger" : "text-ink-mute"}>{c.baseText}</span>
                    <span className={`font-semibold ${c.plusClass}`}> + {c.addedText}</span>
                  </p>
                </div>
                <span className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${c.warn ? "bg-red-50" : c.iconBg}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.icon} alt="" className="w-6 h-6" />
                </span>
              </div>
            </>
          );
          return c.href ? (
            <Link
              key={c.label}
              href={c.href}
              className={`card relative hover:shadow-lg hover:-translate-y-0.5 transition-all ${c.warn ? "ring-2 ring-danger/40 bg-red-50/60" : ""}`}
            >
              {inner}
            </Link>
          ) : (
            <div key={c.label} className="card relative">{inner}</div>
          );
        })}
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        {[
          { href: "/admin/customers", label: "顧客一覧", sub: "検索・編集・履歴", icon: "https://api.iconify.design/fluent-emoji-flat/busts-in-silhouette.svg" },
          { href: "/admin/supports", label: "支援管理", sub: "馬ごと・口数・状態", icon: "https://api.iconify.design/fluent-emoji-flat/horse-face.svg" },
          { href: "/admin/contracts", label: "契約一覧", sub: "A/B/C・停止処理", icon: "https://api.iconify.design/fluent-emoji-flat/page-with-curl.svg" },
          { href: "/admin/payments", label: "決済履歴", sub: "成功・失敗・返金", icon: "https://api.iconify.design/fluent-emoji-flat/credit-card.svg" },
          { href: "/admin/reports", label: "経営管理", sub: "会員推移・月次収支", icon: "https://api.iconify.design/fluent-emoji-flat/calendar.svg" },
          { href: "/admin/giving", label: "寄付状況", sub: "何が増減したか", icon: "https://api.iconify.design/fluent-emoji-flat/sparkles.svg" },
          { href: "/admin/follow-ups", label: "要フォロー", sub: "決済失敗・退会の兆候", icon: "https://api.iconify.design/fluent-emoji-flat/bell.svg" },
        ].map((l) => (
          <Link key={l.href} href={l.href} className="card !p-2.5 hover:shadow-lg hover:-translate-y-0.5 transition-all flex items-center gap-2.5 group">
            <span className="shrink-0 w-9 h-9 rounded-full bg-surface-soft flex items-center justify-center group-hover:bg-brand-50 transition-colors">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={l.icon} alt="" className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <p className="font-bold text-sm group-hover:text-brand-dark transition-colors">{l.label}</p>
              <p className="text-[11px] text-ink-soft mt-0.5 truncate">{l.sub}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Charts row */}
      <div className="grid md:grid-cols-3 gap-3">
        {/* Revenue Chart (day / week / month / year) */}
        <div className="card md:col-span-2">
          <RevenueChart series={revenueSeries} />
        </div>

        {/* Contract Status Donut */}
        <div className="card flex flex-col">
          <h2 className="section-title">契約状態の内訳</h2>
          <div className="flex flex-1 items-center gap-4">
            <div className="relative shrink-0">
              <svg viewBox="0 0 36 36" width="88" height="88" className="-rotate-90">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#f5f5f5" strokeWidth="2.8" />
                {/* active */}
                <circle
                  cx="18" cy="18" r="15" fill="none" stroke="#4a9e7e" strokeWidth="2.8"
                  strokeDasharray={`${total > 0 ? ((activeContracts ?? 0) / total) * (2 * Math.PI * 15) : 0} ${2 * Math.PI * 15}`}
                  strokeDashoffset={2 * Math.PI * 15 / 4}
                  strokeLinecap="round"
                />
                {/* past_due */}
                <circle
                  cx="18" cy="18" r="15" fill="none" stroke="#e85d5d" strokeWidth="2.8"
                  strokeDasharray={`${total > 0 ? ((pastDueCount ?? 0) / total) * (2 * Math.PI * 15) : 0} ${2 * Math.PI * 15}`}
                  strokeDashoffset={2 * Math.PI * 15 / 4 - (total > 0 ? ((activeContracts ?? 0) / total) * (2 * Math.PI * 15) : 0)}
                  strokeLinecap="round"
                />
                {/* canceled */}
                <circle
                  cx="18" cy="18" r="15" fill="none" stroke="#c4c4c4" strokeWidth="2.8"
                  strokeDasharray={`${total > 0 ? ((canceledContracts ?? 0) / total) * (2 * Math.PI * 15) : 0} ${2 * Math.PI * 15}`}
                  strokeDashoffset={2 * Math.PI * 15 / 4 - (total > 0 ? (((activeContracts ?? 0) + (pastDueCount ?? 0)) / total) * (2 * Math.PI * 15) : 0)}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-bold text-ink tabular-nums leading-none">{total}</span>
                <span className="text-[9px] text-ink-mute mt-0.5">件</span>
              </div>
            </div>
            <dl className="space-y-3 text-sm flex-1">
              {[
                { color: "#4a9e7e", label: "有効", count: activeContracts ?? 0 },
                { color: "#e85d5d", label: "失敗", count: pastDueCount ?? 0 },
                { color: "#c4c4c4", label: "解約", count: canceledContracts ?? 0 },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: item.color }} />
                    <span className="text-ink-soft text-xs">{item.label}</span>
                  </div>
                  <span className="font-bold tabular-nums text-sm">{item.count.toLocaleString()}</span>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {/* Tables row */}
      <section className="card">
        <h2 className="section-title">直近の決済</h2>
        <table className="table">
          <thead>
            <tr>
              <th className="w-10 text-right">No.</th>
              <th>日時</th>
              <th>顧客</th>
              <th>種別</th>
              <th>金額</th>
              <th>状態</th>
            </tr>
          </thead>
          <tbody>
            {(recentPayments ?? []).map((p: any, i: number) => (
              <tr key={p.id} className="hover:bg-surface-soft transition-colors">
                <td className="text-right text-ink-mute tabular-nums">{i + 1}</td>
                <td className="tabular-nums">{formatDate(p.occurred_at, true)}</td>
                <td>
                  <span className="font-medium">{p.customer?.full_name ?? p.raw?.stripe_name ?? "—"}</span>
                  {(p.customer?.email ?? p.raw?.stripe_email) && (
                    <span className="block text-xs text-ink-mute">{p.customer?.email ?? p.raw?.stripe_email}</span>
                  )}
                </td>
                <td>{p.kind}</td>
                <td className="tabular-nums font-medium">{formatYen(p.amount)}</td>
                <td>
                  <span
                    className={`chip text-xs ${
                      p.status === "succeeded"
                        ? "chip-ok"
                        : p.status === "failed"
                        ? "chip-error"
                        : "chip-mute"
                    }`}
                  >
                    {p.status === "succeeded" ? "成功" : p.status === "failed" ? "失敗" : p.status}
                  </span>
                </td>
              </tr>
            ))}
            {(recentPayments ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="text-center text-ink-mute py-6">
                  決済履歴はまだありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="grid md:grid-cols-2 gap-3">
        <div className="card">
          <h2 className="section-title">最近の支援申込</h2>
          <ul className="divide-y divide-surface-line">
            {(recentSupports ?? []).map((s: any) => (
              <li key={s.id} className="py-3 flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-sm">{s.customer?.full_name}</span>
                  <span className="text-ink-mute mx-1.5">→</span>
                  {s.horse?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.horse.image_url} alt={s.horse?.name ?? ""} className="w-6 h-6 rounded-md object-cover inline-block align-text-bottom mr-1" />
                  ) : (
                    <Image src={horseImage} alt="" width={16} height={16} className="inline-block w-4 h-4 rounded-sm object-cover align-text-bottom mr-1" />
                  )}
                  <span className="text-sm text-brand font-medium">{s.horse?.name}</span>
                </div>
                <span className="text-xs text-ink-mute shrink-0">{formatDate(s.created_at)}</span>
              </li>
            ))}
            {(recentSupports ?? []).length === 0 && (
              <li className="text-ink-mute py-4 text-sm text-center">データなし</li>
            )}
          </ul>
        </div>

        <div className="card">
          <h2 className="section-title">今後のイベント</h2>
          <ul className="divide-y divide-surface-line">
            {(upcomingEvents ?? []).map((e: any) => (
              <li key={e.id} className="py-3 flex items-center justify-between gap-2">
                <Link href={`/admin/events/${e.id}`} className="text-brand underline text-sm font-medium hover:text-brand-dark">
                  📅 {e.title}
                </Link>
                <span className="text-xs text-ink-mute shrink-0">{formatDate(e.starts_at, true)}</span>
              </li>
            ))}
            {(upcomingEvents ?? []).length === 0 && (
              <li className="text-ink-mute py-4 text-sm text-center">予定はありません。</li>
            )}
          </ul>
        </div>
      </section>
    </div>
  );
}
