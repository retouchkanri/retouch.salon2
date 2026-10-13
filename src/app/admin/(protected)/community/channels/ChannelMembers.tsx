"use client";

import { useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/format";
import CustomerPicker, { type PickedCustomer } from "../CustomerPicker";

type Member = {
  user_id: string;
  joined_at: string;
  last_read_at: string | null;
  full_name: string | null;
  email: string | null;
  display_name: string | null;
};

/** 公開チャンネルで、運営が手動で追加（granted）・削除（removed）した会員。 */
type Override = {
  user_id: string;
  access: "granted" | "removed";
  joined_at: string;
  full_name: string | null;
  email: string | null;
  display_name: string | null;
};

type Action = "add" | "remove" | "reset";

/**
 * チャンネルのメンバー管理（どのチャンネルでも、運営が会員を追加・削除できる）。
 *   非公開チャンネル: メンバーの一覧から外す・会員を検索して追加する。
 *   公開チャンネル: 対象者は自動で参加する。対象者ではない会員を追加したり、特定の会員を外したりできる。
 */
export default function ChannelMembers({ channelId, visibility }: { channelId: string; visibility: "public" | "private" }) {
  const isPrivate = visibility === "private";
  const [members, setMembers] = useState<Member[] | null>(null);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [picked, setPicked] = useState<PickedCustomer[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/community/channels/${channelId}/members`);
    const j = await res.json().catch(() => ({}));
    if (res.ok) {
      setMembers(j.members ?? []);
      setOverrides(j.overrides ?? []);
    } else {
      setMsg({ ok: false, text: j.error ?? "メンバーを読み込めませんでした。" });
    }
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 追加・削除・取り消しを送る。成功したら結果（変わった人数など）を返す。 */
  const change = async (action: Action, body: { customer_ids?: string[]; user_ids?: string[] }) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/admin/community/channels/${channelId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: j.error ?? "保存できませんでした。" });
      return null;
    }
    void load();
    return j as { changed: number; unchanged: number; skipped: number };
  };

  const applyPicked = async (action: "add" | "remove") => {
    if (picked.length === 0) return;
    if (action === "remove" && !window.confirm(`選択した${picked.length}人をこのチャンネルから外しますか？`)) return;
    const j = await change(action, { customer_ids: picked.map((p) => p.id) });
    if (!j) return;
    setPicked([]);
    const noLogin = j.skipped > 0 ? `（ログイン未設定の${j.skipped}人は対象外です）` : "";
    setMsg({
      ok: true,
      text:
        action === "add"
          ? `${j.changed}人を追加しました。${j.unchanged > 0 ? `（${j.unchanged}人はすでにメンバーです）` : ""}${noLogin}`
          : `${j.changed}人を外しました。${j.unchanged > 0 ? `（${j.unchanged}人はメンバーではありません）` : ""}${noLogin}`,
    });
  };

  const removeMember = async (m: Member) => {
    if (!window.confirm(`${m.full_name ?? m.display_name ?? "このメンバー"} をチャンネルから外しますか？`)) return;
    await change("remove", { user_ids: [m.user_id] });
  };

  const resetOverride = async (o: Override) => {
    const name = o.full_name ?? o.display_name ?? "この会員";
    const text =
      o.access === "granted"
        ? `${name} の「手動で追加」を取り消しますか？\nこのチャンネルの対象者でなければ、メンバーではなくなります。`
        : `${name} の「手動で削除」を取り消しますか？\nこのチャンネルの対象者であれば、メンバーに戻ります。`;
    if (!window.confirm(text)) return;
    await change("reset", { user_ids: [o.user_id] });
  };

  return (
    <section className="card space-y-4">
      <h2 className="font-semibold text-lg">メンバーの追加・削除{isPrivate ? "（非公開チャンネル）" : "（公開チャンネル）"}</h2>
      <div className="space-y-2">
        <p className="text-sm text-ink-soft">
          {isPrivate
            ? "会員を検索して選び、「追加」を押してください。追加した会員は、会員種別に関係なくこのチャンネルに参加します。"
            : "このチャンネルは、上の「対象者」に当てはまる会員が自動で参加します。ここでは、対象者ではない会員を追加したり、特定の会員を外したりできます（運営が決めた内容が、対象者の規則より優先されます）。"}
        </p>
        <CustomerPicker value={picked} onChange={setPicked} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary !px-4 !py-2 text-sm" disabled={busy || picked.length === 0} onClick={() => void applyPicked("add")}>
            {busy ? "保存中…" : `選択した${picked.length}人を追加`}
          </button>
          {!isPrivate && (
            <button type="button" className="btn-secondary !px-4 !py-2 text-sm" disabled={busy || picked.length === 0} onClick={() => void applyPicked("remove")}>
              選択した{picked.length}人を外す
            </button>
          )}
        </div>
        {!isPrivate && (
          <p className="text-xs text-ink-mute">
            外した会員は、運営が追加し直すか、下の一覧で取り消すまで、このチャンネルを閲覧できません。いまのメンバーの一覧は、コミュニティの画面でチャンネルを開き「メンバー」から確認できます（そこからも追加・削除できます）。
          </p>
        )}
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-danger"}`}>{msg.text}</p>}

      {members === null ? (
        <p className="text-sm text-ink-mute">読み込み中…</p>
      ) : isPrivate ? (
        members.length === 0 ? (
          <p className="text-sm text-ink-mute">まだメンバーがいません。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>氏名</th>
                  <th>表示名</th>
                  <th>メール</th>
                  <th>追加日</th>
                  <th>最終既読</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td>{m.full_name ?? "（運営または氏名なし）"}</td>
                    <td>{m.display_name ?? "—"}</td>
                    <td className="text-xs">{m.email ?? "—"}</td>
                    <td className="text-xs whitespace-nowrap">{formatDate(m.joined_at)}</td>
                    <td className="text-xs whitespace-nowrap">{m.last_read_at ? formatDate(m.last_read_at, true) : "—"}</td>
                    <td>
                      <button type="button" className="text-danger underline text-sm" disabled={busy} onClick={() => void removeMember(m)}>
                        外す
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">運営が手動で追加・削除した会員</h3>
          {overrides.length === 0 ? (
            <p className="text-sm text-ink-mute">手動で追加・削除した会員はいません（対象者の規則どおりです）。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>氏名</th>
                    <th>表示名</th>
                    <th>メール</th>
                    <th>状態</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {overrides.map((o) => (
                    <tr key={o.user_id}>
                      <td>{o.full_name ?? "（氏名なし）"}</td>
                      <td>{o.display_name ?? "—"}</td>
                      <td className="text-xs">{o.email ?? "—"}</td>
                      <td>
                        <span className={`chip text-xs ${o.access === "granted" ? "chip-ok" : "chip-mute"}`}>
                          {o.access === "granted" ? "手動で追加" : "手動で削除"}
                        </span>
                      </td>
                      <td>
                        <button type="button" className="text-brand underline text-sm" disabled={busy} onClick={() => void resetOverride(o)}>
                          取り消す
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
