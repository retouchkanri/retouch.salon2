"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sendMemberMessageUntilDone, type SendProgress } from "@/lib/memberMessagesClient";
import SendProgressBar from "../SendProgressBar";

export default function MessageActions({
  id,
  status,
  failedCount = 0,
  pendingCount = 0,
  /** アクティブ会員数より配信先が少ないとき（取りこぼしの可能性） */
  audienceGap = 0,
  recipientCount = 0,
}: {
  id: string;
  status: string;
  failedCount?: number;
  pendingCount?: number;
  audienceGap?: number;
  recipientCount?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [progress, setProgress] = useState<SendProgress | null>(null);

  const runLoop = async () => {
    const result = await sendMemberMessageUntilDone(id, (p) => {
      setProgress(p);
      setMsg(
        p.recipientCount > 0
          ? `配信中… ${p.sentCount} / ${p.recipientCount} 件送信済み`
          : `配信中… ${p.sentCount} 件送信済み`,
      );
    });

    setBusy(false);
    if (!result.ok) {
      setMsg(result.error ?? "配信に失敗しました。");
      router.refresh();
      return;
    }
    if (result.throttled) {
      setMsg(
        `メール送信側の問題を検知したため、送信 ${result.progress.sentCount} 件で一時停止しました（残り ${result.progress.remaining} 件は未送信のまま保持されています）。` +
          `時間をおいてから、このページの配信ボタンで再開できます（自動配信 cron が動いていれば自動でも再開されます）。` +
          (result.throttleReason ? `\n検知した内容: ${result.throttleReason}` : ""),
      );
    } else if (result.finished) {
      setMsg(`配信が完了しました（送信 ${result.progress.sentCount} 件）。`);
    } else {
      setMsg(
        `送信 ${result.progress.sentCount} 件まで完了しましたが処理が長時間に及んだため中断しました。もう一度「配信を続ける」を押すか、しばらく待つと自動配信（cron）が続きを送信します。残り ${result.progress.remaining} 件。`,
      );
    }
    router.refresh();
  };

  const send = async (opts?: { fillGaps?: boolean }) => {
    if (
      !confirm(
        opts?.fillGaps
          ? `配信対象に含まれていない会員（推定 ${audienceGap.toLocaleString("ja-JP")} 名）を追加して送信します。よろしいですか？\n（送信済みの方には再送されません）`
          : status === "sending" || pendingCount > 0
            ? "未送信分の配信を続けますか？"
            : "今すぐ配信しますか？（件数の上限はありません。完了まで自動的に配信を続けます）",
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    setProgress(null);
    await runLoop();
  };

  const retryFailed = async () => {
    if (
      !confirm(
        `送信に失敗した ${failedCount} 件を未送信に戻して再配信します。よろしいですか？\n（送信済みと記録されている方には再送されません）`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    setProgress(null);
    let j: any = {};
    try {
      const res = await fetch(`/api/admin/member-messages/${id}/retry-failed`, { method: "POST" });
      j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setBusy(false);
        setMsg(j.error ?? "再送の準備に失敗しました。");
        return;
      }
    } catch {
      setBusy(false);
      setMsg("通信エラーが発生しました。時間をおいて再度お試しください。");
      return;
    }
    if ((j.reset ?? 0) === 0 && (j.pending ?? 0) === 0) {
      setBusy(false);
      setMsg("再送の対象がありません（最新の状態はページを再読み込みすると確認できます）。");
      router.refresh();
      return;
    }
    setMsg(`${j.reset ?? 0} 件を未送信に戻しました。配信を再開します…`);
    await runLoop();
  };

  const remove = async () => {
    if (!confirm("この配信を削除します。よろしいですか？")) return;
    setBusy(true);
    const res = await fetch(`/api/admin/member-messages/${id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? "削除に失敗しました。");
      return;
    }
    router.push("/admin/member-messages");
  };

  const showContinue = (status !== "sent" && status !== "canceled") || pendingCount > 0;

  return (
    <div className="space-y-2">
      {audienceGap > 0 && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          アクティブ会員より配信先が {audienceGap.toLocaleString("ja-JP")} 名少ないです（配信先{" "}
          {recipientCount.toLocaleString("ja-JP")} 名）。取りこぼしの可能性があるため、不足分の追加送信を推奨します。
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {showContinue && (
          <button className="btn-primary" disabled={busy} onClick={() => send()}>
            {busy
              ? "配信中…"
              : status === "sending" || pendingCount > 0
                ? "配信を続ける"
                : "今すぐ配信（全件・件数無制限）"}
          </button>
        )}
        {audienceGap > 0 && status !== "canceled" && status !== "draft" && (
          <button className="btn-primary" disabled={busy} onClick={() => send({ fillGaps: true })}>
            {busy ? "配信中…" : `不足分を追加して送信（約 ${audienceGap.toLocaleString("ja-JP")} 名）`}
          </button>
        )}
        {/* 配信済でも漏れ確認のため再実行できる（送信済みには再送されない） */}
        {status === "sent" && audienceGap <= 0 && pendingCount === 0 && (
          <button className="btn-secondary" disabled={busy} onClick={() => send({ fillGaps: true })}>
            {busy ? "確認中…" : "対象者の漏れを確認して追加送信"}
          </button>
        )}
        {failedCount > 0 && (status === "sent" || status === "sending") && (
          <button className="btn-secondary" disabled={busy} onClick={retryFailed}>
            失敗分を再送（{failedCount}件）
          </button>
        )}
        <button className="btn-danger" disabled={busy} onClick={remove}>
          削除
        </button>
      </div>
      {/* 送信完了後もバーを残し、最終的な到達件数が確認できるようにする。 */}
      {progress && <SendProgressBar progress={progress} done={!busy} />}
      {msg && <p className="text-sm whitespace-pre-wrap">{msg}</p>}
    </div>
  );
}
