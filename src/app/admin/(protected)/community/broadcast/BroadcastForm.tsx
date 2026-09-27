"use client";

import { useState } from "react";
import {
  MEMBER_CODES,
  MEMBER_CODE_LABELS,
  MESSAGE_MAX_LENGTH,
  PAID_MEMBER_CODES,
  type MemberCode,
} from "@/lib/community/constants";
import CustomerPicker, { type PickedCustomer } from "../CustomerPicker";

type Mode = "audience" | "users";
type Audience = "all" | "plans" | "supporters";

/** 運営から会員へのダイレクトメッセージ一括送信。 */
export default function BroadcastForm({ horses }: { horses: { id: string; name: string }[] }) {
  const [mode, setMode] = useState<Mode>("audience");
  const [audience, setAudience] = useState<Audience>("all");
  const [codes, setCodes] = useState<MemberCode[]>([]);
  const [horseIds, setHorseIds] = useState<string[]>([]);
  const [horseFilter, setHorseFilter] = useState("");
  const [picked, setPicked] = useState<PickedCustomer[]>([]);
  const [body, setBody] = useState("");
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const payload = (preview: boolean) => ({
    mode,
    audience,
    plan_codes: codes,
    horse_ids: horseIds,
    customer_ids: picked.map((p) => p.id),
    body,
    preview,
  });

  const call = async (preview: boolean) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/admin/community/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload(preview)),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMsg({ ok: false, text: j.error ?? "処理できませんでした。" });
      return null;
    }
    return j;
  };

  const preview = async () => {
    const j = await call(true);
    if (j) setCount(Number(j.count ?? 0));
  };

  const sendAll = async () => {
    if (!body.trim()) {
      setMsg({ ok: false, text: "メッセージを入力してください。" });
      return;
    }
    const p = await call(true);
    if (!p) return;
    const n = Number(p.count ?? 0);
    setCount(n);
    if (n === 0) {
      setMsg({ ok: false, text: "送信対象の会員がいません。" });
      return;
    }
    if (!window.confirm(`${n}人の会員に、あなたのアカウントから個別のダイレクトメッセージを送信します。よろしいですか？`)) return;
    const j = await call(false);
    if (j) {
      setMsg({ ok: true, text: `${j.sent}人に送信しました。` });
      setBody("");
    }
  };

  const resetCount = () => setCount(null);
  const filteredHorses = horses.filter((h) => !horseFilter.trim() || h.name.includes(horseFilter.trim()));

  return (
    <div className="space-y-5">
      <section className="card space-y-4">
        <fieldset>
          <legend className="label">送信先の指定方法</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "audience"} onChange={() => { setMode("audience"); resetCount(); }} />
              条件で指定
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "users"} onChange={() => { setMode("users"); resetCount(); }} />
              会員を個別に指定
            </label>
          </div>
        </fieldset>

        {mode === "audience" ? (
          <fieldset className="space-y-3">
            <legend className="label">対象</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {(
                [
                  ["all", "全会員"],
                  ["plans", "会員種別（ランク）"],
                  ["supporters", "支援者（馬）"],
                ] as [Audience, string][]
              ).map(([a, label]) => (
                <label key={a} className="flex items-center gap-2">
                  <input type="radio" checked={audience === a} onChange={() => { setAudience(a); resetCount(); }} />
                  {label}
                </label>
              ))}
            </div>
            {audience === "plans" && (
              <div className="rounded border border-surface-line p-3 space-y-2">
                <div className="grid sm:grid-cols-2 gap-1.5 text-sm">
                  {MEMBER_CODES.map((c) => (
                    <label key={c} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={codes.includes(c)}
                        onChange={() => {
                          setCodes((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
                          resetCount();
                        }}
                      />
                      {MEMBER_CODE_LABELS[c]}
                    </label>
                  ))}
                </div>
                <button type="button" className="text-xs text-brand underline" onClick={() => { setCodes([...PAID_MEMBER_CODES]); resetCount(); }}>
                  有料会員種別をすべて選択
                </button>
              </div>
            )}
            {audience === "supporters" && (
              <div className="rounded border border-surface-line p-3 space-y-2">
                <p className="text-xs text-ink-mute">馬を選ばない場合は、いずれかの馬を支援中の会員全員が対象です。</p>
                <input className="input" placeholder="馬名で絞り込み" value={horseFilter} onChange={(e) => setHorseFilter(e.target.value)} />
                <div className="max-h-56 overflow-y-auto grid sm:grid-cols-2 gap-1 text-sm">
                  {filteredHorses.map((h) => (
                    <label key={h.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={horseIds.includes(h.id)}
                        onChange={() => {
                          setHorseIds((prev) => (prev.includes(h.id) ? prev.filter((x) => x !== h.id) : [...prev, h.id]));
                          resetCount();
                        }}
                      />
                      {h.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </fieldset>
        ) : (
          <div className="space-y-2">
            <p className="label">送信先の会員</p>
            <CustomerPicker value={picked} onChange={(v) => { setPicked(v); resetCount(); }} />
            <p className="text-xs text-ink-mute">ログイン用アカウントが無い会員・退会済み・利用停止中の会員には送信されません。</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={preview} disabled={busy} className="btn-secondary !px-4 !py-2 text-sm">
            対象人数を確認
          </button>
          {count !== null && <span className="text-sm font-semibold">対象: {count.toLocaleString("ja-JP")}人</span>}
        </div>
      </section>

      <section className="card space-y-3">
        <label className="label" htmlFor="bc-body">
          メッセージ <span className="text-danger">*</span>
        </label>
        <textarea
          id="bc-body"
          className="input"
          rows={8}
          maxLength={MESSAGE_MAX_LENGTH}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="会員それぞれに、あなたとのダイレクトメッセージとして届きます。"
        />
        <p className="text-xs text-ink-mute">
          {body.length}/{MESSAGE_MAX_LENGTH}文字。*太字* ~取り消し~ などの書式とURLのリンクが使えます。返信は各会員とのDMに届きます。
        </p>
        {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-danger"}`}>{msg.text}</p>}
        <button type="button" onClick={sendAll} disabled={busy || !body.trim()} className="btn-primary !px-6 !py-2.5">
          {busy ? "処理中…" : "個別メッセージを一括送信"}
        </button>
      </section>
    </div>
  );
}
