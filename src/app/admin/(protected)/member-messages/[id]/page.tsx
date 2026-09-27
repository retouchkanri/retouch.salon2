import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/format";
import MemberMessageForm from "../MemberMessageForm";
import MessageActions from "./MessageActions";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  scheduled: "予約",
  sending: "配信中",
  sent: "配信済",
  canceled: "取消",
};
const EMAIL_STATUS_LABEL: Record<string, string> = {
  pending: "未送信",
  sent: "送信済",
  failed: "失敗",
  skipped: "対象外",
};
const AUDIENCE_LABEL: Record<string, string> = {
  all: "全アクティブ会員",
  rpt_only: "リタポメンバー",
  support_only: "1口支援者のみ",
  no_class: "空白の人のみ（無料会員）",
  subset: "指定会員",
  class_attender: "アテンダー会員",
  class_owner: "オーナーズ会員",
  class_b: "サポーター会員",
  class_a: "メンバーズ会員",
  class_c: "リェリーフ会員",
  class_support: "ヘルパーズ会員",
  team_only: "がんがんチーム",
};

function audienceList(m: any): string[] {
  return Array.isArray(m.audiences) && m.audiences.length > 0 ? m.audiences : [m.audience];
}
function audienceLabel(m: any): string {
  return audienceList(m).map((a) => AUDIENCE_LABEL[a] ?? "指定会員").join("、");
}

export default async function MemberMessageDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { rstatus?: string };
}) {
  await requireCapability("messages.manage");
  const admin = createSupabaseAdminClient();

  const { data: message } = await admin
    .from("member_messages")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!message) notFound();
  const m = message as any;

  const editable = m.status === "draft" || m.status === "scheduled";
  const rstatus = ["pending", "sent", "failed", "skipped"].includes(searchParams?.rstatus ?? "")
    ? (searchParams!.rstatus as string)
    : "";

  // 送信状態の内訳（全件の集計。下の一覧は表示上限があるためここで正確な数を出す）
  const countBase = () =>
    admin
      .from("member_message_recipients")
      .select("id", { count: "exact", head: true })
      .eq("message_id", params.id);
  const [{ count: cPending }, { count: cSent }, { count: cFailed }, { count: cSkipped }] =
    await Promise.all([
      countBase().eq("email_status", "pending"),
      countBase().eq("email_status", "sent"),
      countBase().eq("email_status", "failed"),
      countBase().eq("email_status", "skipped"),
    ]);
  const statusCounts = {
    pending: cPending ?? 0,
    sent: cSent ?? 0,
    failed: cFailed ?? 0,
    skipped: cSkipped ?? 0,
  };
  const statusTotal =
    statusCounts.pending + statusCounts.sent + statusCounts.failed + statusCounts.skipped;

  // 指定会員の場合は名前を解決してフォームへ渡す
  let initialTargets: { id: string; full_name: string | null; email: string | null }[] = [];
  if (audienceList(m).includes("subset") && (m.target_customer_ids ?? []).length > 0) {
    const { data } = await admin
      .from("customers")
      .select("id, full_name, email")
      .in("id", m.target_customer_ids);
    initialTargets = (data as any[]) ?? [];
  }

  // 配信先一覧（画面表示は300件まで。送信自体に件数上限はない。絞り込みで全状態を確認できる）
  let recipientsQuery = admin
    .from("member_message_recipients")
    .select("id, email, email_status, error, opened_at, read_at, customer:customers(full_name)")
    .eq("message_id", params.id)
    .order("created_at", { ascending: true })
    .limit(300);
  if (rstatus) recipientsQuery = recipientsQuery.eq("email_status", rstatus);
  const { data: recipients } = await recipientsQuery;

  const openRate = m.sent_count > 0 ? Math.round((m.open_count / m.sent_count) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">配信詳細</h1>
        <Link href="/admin/member-messages" className="text-brand underline">一覧へ戻る</Link>
      </div>

      <div className="card grid sm:grid-cols-3 gap-3 text-sm">
        <div>
          <span className="text-ink-mute">状態</span>
          <div className="font-semibold">
            {STATUS_LABEL[m.status] ?? m.status}
            {m.status === "sent" && statusCounts.failed > 0 && (
              <span className="ml-1 text-red-600 font-normal">（一部失敗）</span>
            )}
          </div>
        </div>
        <div><span className="text-ink-mute">チャネル</span><div>{[m.channel_inapp && "お知らせ", m.channel_email && "メール"].filter(Boolean).join(" / ") || "—"}</div></div>
        <div><span className="text-ink-mute">対象</span><div>{audienceLabel(m)}</div></div>
        <div>
          <span className="text-ink-mute">配信先 / 送信</span>
          <div className="tabular-nums">
            {m.recipient_count} / {m.sent_count}
            {statusCounts.failed > 0 && <span className="ml-2 text-red-600">失敗 {statusCounts.failed}</span>}
            {statusCounts.pending > 0 && <span className="ml-2 text-amber-600">未送信 {statusCounts.pending}</span>}
            {statusCounts.skipped > 0 && <span className="ml-2 text-ink-mute">対象外 {statusCounts.skipped}</span>}
          </div>
        </div>
        <div><span className="text-ink-mute">開封（ユニーク）</span><div className="tabular-nums">{m.open_count}（開封率 {openRate}%）</div></div>
        <div><span className="text-ink-mute">{m.status === "scheduled" ? "予約日時" : "配信日時"}</span><div>{formatDate(m.status === "scheduled" ? m.scheduled_at : m.sent_at, true)}</div></div>
      </div>

      <MessageActions
        id={m.id}
        status={m.status}
        failedCount={statusCounts.failed}
        pendingCount={statusCounts.pending}
      />

      {editable ? (
        <section className="space-y-2">
          <h2 className="font-bold">編集</h2>
          <MemberMessageForm initial={m} id={m.id} initialTargets={initialTargets} />
        </section>
      ) : (
        <section className="space-y-2">
          <h2 className="font-bold">本文</h2>
          <div className="card">
            <p className="font-semibold mb-2">{m.title}</p>
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: m.body_format === "text" ? "" : m.body }} />
            {m.body_format === "text" && <pre className="whitespace-pre-wrap text-sm">{m.body}</pre>}
            {((m.image_urls as string[] | null) ?? []).filter(Boolean).map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={url} alt={`添付画像 ${i + 1}`} className="mt-4 w-full max-w-md rounded-xl object-contain" />
            ))}
            {((m.pdf_urls as string[] | null) ?? []).filter(Boolean).length > 0 && (
              <div className="mt-4 space-y-2">
                {((m.pdf_urls as string[]) ?? []).filter(Boolean).map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-brand underline text-sm">
                    📄 添付資料{((m.pdf_urls as string[]) ?? []).length > 1 ? ` ${i + 1}` : ""}（PDF）
                  </a>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {m.channel_email && statusTotal > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">配信先一覧</h2>
          <p className="text-xs text-ink-mute">
            画面に表示されるのは最大300件です（送信自体に件数の上限はありません）。状態で絞り込むと該当分を確認できます。
          </p>
          <div className="flex flex-wrap gap-2 text-xs">
            {[
              { key: "", label: `すべて（${statusTotal}）` },
              { key: "sent", label: `送信済（${statusCounts.sent}）` },
              { key: "failed", label: `失敗（${statusCounts.failed}）` },
              { key: "pending", label: `未送信（${statusCounts.pending}）` },
              { key: "skipped", label: `対象外（${statusCounts.skipped}）` },
            ].map((f) => (
              <Link
                key={f.key || "all"}
                href={f.key ? `/admin/member-messages/${m.id}?rstatus=${f.key}` : `/admin/member-messages/${m.id}`}
                className={`px-2 py-1 rounded-lg border ${rstatus === f.key ? "bg-brand text-white border-brand" : "border-surface-line"}`}
              >
                {f.label}
              </Link>
            ))}
          </div>
          <div className="card p-0 overflow-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>会員</th>
                  <th>メール</th>
                  <th>送信状態</th>
                  <th>エラー</th>
                  <th>開封</th>
                  <th>既読</th>
                </tr>
              </thead>
              <tbody>
                {(recipients ?? []).map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.customer?.full_name ?? "—"}</td>
                    <td className="text-xs">{r.email ?? "—"}</td>
                    <td className={`text-xs ${r.email_status === "failed" ? "text-red-600" : ""}`}>
                      {EMAIL_STATUS_LABEL[r.email_status] ?? r.email_status}
                    </td>
                    <td className="text-xs max-w-[240px] truncate" title={r.error ?? ""}>{r.error ?? "—"}</td>
                    <td className="text-xs">{r.opened_at ? formatDate(r.opened_at, true) : "—"}</td>
                    <td className="text-xs">{r.read_at ? formatDate(r.read_at, true) : "—"}</td>
                  </tr>
                ))}
                {(recipients ?? []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-4 text-ink-mute">該当する配信先がありません。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
