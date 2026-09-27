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

/** 非公開チャンネルのメンバー管理。 */
export default function ChannelMembers({ channelId }: { channelId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [picked, setPicked] = useState<PickedCustomer[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/community/channels/${channelId}/members`);
    const j = await res.json().catch(() => ({}));
    if (res.ok) setMembers(j.members ?? []);
    else setMsg({ ok: false, text: j.error ?? "メンバーを読み込めませんでした。" });
  }, [channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (picked.length === 0) return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/admin/community/channels/${channelId}/members`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_ids: picked.map((p) => p.id) }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: j.error ?? "追加できませんでした。" });
      return;
    }
    setPicked([]);
    setMsg({
      ok: true,
      text: `${j.added}人を追加しました。${j.skipped > 0 ? `（ログイン未設定の${j.skipped}人は追加できませんでした）` : ""}`,
    });
    void load();
  };

  const removeMember = async (m: Member) => {
    if (!window.confirm(`${m.full_name ?? m.display_name ?? "このメンバー"} をチャンネルから外しますか？`)) return;
    const res = await fetch(`/api/admin/community/channels/${channelId}/members`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user_id: m.user_id }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg({ ok: false, text: j.error ?? "外せませんでした。" });
      return;
    }
    void load();
  };

  return (
    <section className="card space-y-4">
      <h2 className="font-semibold text-lg">メンバー（非公開チャンネル）</h2>
      <div className="space-y-2">
        <p className="text-sm text-ink-soft">追加する会員を検索して選び、「追加」を押してください。</p>
        <CustomerPicker value={picked} onChange={setPicked} />
        <button type="button" className="btn-primary !px-4 !py-2 text-sm" disabled={busy || picked.length === 0} onClick={add}>
          {busy ? "追加中…" : `選択した${picked.length}人を追加`}
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-danger"}`}>{msg.text}</p>}
      {members === null ? (
        <p className="text-sm text-ink-mute">読み込み中…</p>
      ) : members.length === 0 ? (
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
                    <button type="button" className="text-danger underline text-sm" onClick={() => removeMember(m)}>
                      外す
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
