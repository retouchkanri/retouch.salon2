"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  HORSE_MEETING_ARRIVAL_METHODS,
  HORSE_MEETING_FACILITIES,
  HORSE_MEETING_TIME_SLOTS,
  horseMeetingArrivalLabel,
  horseMeetingFacilityLabel,
  horseMeetingStatusLabel,
} from "@/lib/horseMeetings";
import type { HorseMeetingRequest } from "@/types/db";

type Props = {
  customerName: string;
  defaultApplicantName: string;
  defaultSupportedHorses: string;
  existing: HorseMeetingRequest[];
  /** 面会の新規申込・取消を会員自身が行えるか。false の場合は履歴の閲覧のみ。 */
  selfServiceEnabled?: boolean;
};

export default function HorseMeetingForm({
  customerName,
  defaultApplicantName,
  defaultSupportedHorses,
  existing,
  selfServiceEnabled = true,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    applicant_name: defaultApplicantName || customerName,
    facility: HORSE_MEETING_FACILITIES[0].value,
    party_size: "1",
    preferred_date: "",
    preferred_time_slot: HORSE_MEETING_TIME_SLOTS[0],
    supported_horses: defaultSupportedHorses,
    arrival_method: "car" as string,
    pickup_time: "",
    note: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((p) => ({ ...p, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    const res = await fetch("/api/mypage/horse-meetings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...form,
        party_size: Number(form.party_size),
        pickup_time: form.arrival_method === "car" ? null : form.pickup_time || null,
        note: form.note || null,
      }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setErr(j.error ?? "申込できませんでした");
      return;
    }
    setMsg("馬の面会を申し込みました。運営よりご連絡いたします。");
    router.refresh();
  };

  const cancelRequest = async (id: string) => {
    if (!confirm("この申込を取消します。よろしいですか？")) return;
    setBusy(true);
    setErr(null);
    const res = await fetch(`/api/mypage/horse-meetings/${id}`, { method: "PATCH" });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setErr(j.error ?? "取消できませんでした");
      return;
    }
    router.refresh();
  };

  const needsPickupTime = form.arrival_method !== "car";

  return (
    <div className="space-y-6">
      {!selfServiceEnabled ? (
        <div className="card border-2 border-brand/20 bg-brand-50/30">
          <p className="text-sm text-ink-soft leading-relaxed">
            馬の面会のお申し込み・取消は、現在運営にて承っております。
            お手数ですが運営までお問い合わせください。
          </p>
        </div>
      ) : (
        <>
      <div className="card border-2 border-brand/20 bg-brand-50/30">
        <p className="text-sm text-ink-soft leading-relaxed">
          半口以上の支援会員様は、支援している馬との<strong>個別面会</strong>をお申し込みいただけます。
          希望日時を送信いただき、運営が日程を調整のうえご連絡いたします（イベントマスタへの個別登録は不要です）。
        </p>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        <h2 className="section-title mb-0">面会申込フォーム</h2>

        <div>
          <label className="label">（１）お名前</label>
          <input className="input" value={form.applicant_name} onChange={set("applicant_name")} required />
        </div>

        <div>
          <label className="label">（２）施設名</label>
          <select className="input" value={form.facility} onChange={set("facility")}>
            {HORSE_MEETING_FACILITIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">（３）参加人数 ※同伴者を含めて何名になりますか？</label>
          <input
            type="number"
            min={1}
            max={20}
            className="input w-32"
            value={form.party_size}
            onChange={set("party_size")}
            required
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">（４）希望日</label>
            <input type="date" className="input" value={form.preferred_date} onChange={set("preferred_date")} required />
          </div>
          <div>
            <label className="label">希望時間帯</label>
            <select className="input" value={form.preferred_time_slot} onChange={set("preferred_time_slot")}>
              {HORSE_MEETING_TIME_SLOTS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">（５）支援対象馬 ※すべてご記入ください</label>
          <textarea
            className="input min-h-[88px]"
            value={form.supported_horses}
            onChange={set("supported_horses")}
            placeholder="例：28:ヒカル（0.5口）、38：ホープ（1口）"
            required
          />
        </div>

        <div>
          <label className="label">（６）来場方法</label>
          <div className="space-y-2">
            {HORSE_MEETING_ARRIVAL_METHODS.map((a) => (
              <label key={a.value} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="arrival_method"
                  className="mt-1"
                  checked={form.arrival_method === a.value}
                  onChange={() => setForm((p) => ({ ...p, arrival_method: a.value }))}
                />
                <span className="text-sm">{a.label}</span>
              </label>
            ))}
          </div>
          {needsPickupTime && (
            <div className="mt-2">
              <label className="label text-xs">お迎え希望時刻</label>
              <input
                className="input"
                value={form.pickup_time}
                onChange={set("pickup_time")}
                placeholder="例：10:30"
                required={needsPickupTime}
              />
            </div>
          )}
        </div>

        <div>
          <label className="label">（７）その他（ご連絡事項等）</label>
          <textarea className="input min-h-[72px]" value={form.note} onChange={set("note")} />
        </div>

        {err && <p className="text-danger text-sm">{err}</p>}
        {msg && <p className="text-ok text-sm">{msg}</p>}

        <button className="btn-primary" disabled={busy}>
          {busy ? "送信中..." : "この内容で申し込む"}
        </button>
      </form>
        </>
      )}

      <section className="card">
        <h2 className="section-title">申込履歴</h2>
        {existing.length === 0 ? (
          <p className="text-ink-mute text-sm">まだ申込履歴はありません。</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {existing.map((r) => (
              <li key={r.id} className="py-4 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">
                    {r.preferred_date} {r.preferred_time_slot}
                  </span>
                  <span className="chip-mute">{horseMeetingStatusLabel(r.status)}</span>
                </div>
                <p className="text-sm text-ink-soft">
                  {horseMeetingFacilityLabel(r.facility)} / {r.party_size}名
                </p>
                <p className="text-xs text-ink-mute">
                  来場: {horseMeetingArrivalLabel(r.arrival_method, r.pickup_time)}
                </p>
                {selfServiceEnabled && (r.status === "pending" || r.status === "approved") ? (
                  <button
                    type="button"
                    className="text-danger underline text-sm mt-1"
                    onClick={() => cancelRequest(r.id)}
                    disabled={busy}
                  >
                    取消する
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
