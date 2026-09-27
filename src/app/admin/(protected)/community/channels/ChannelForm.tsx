"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AUDIENCE_LABELS,
  CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_LABELS,
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  CHANNEL_TOPIC_MAX,
  MEMBER_CODES,
  MEMBER_CODE_LABELS,
  PAID_MEMBER_CODES,
  type ChannelAudience,
  type ChannelCategory,
  type MemberCode,
} from "@/lib/community/constants";

export type ChannelFormValue = {
  name: string;
  description: string;
  topic: string;
  category: ChannelCategory;
  visibility: "public" | "private";
  audience: ChannelAudience;
  audience_plan_codes: MemberCode[];
  audience_horse_ids: string[];
  post_policy: "everyone" | "staff";
  auto_join: boolean;
  is_required: boolean;
  sort_order: number;
  is_archived: boolean;
};

export const EMPTY_CHANNEL: ChannelFormValue = {
  name: "",
  description: "",
  topic: "",
  category: "general",
  visibility: "public",
  audience: "all",
  audience_plan_codes: [],
  audience_horse_ids: [],
  post_policy: "everyone",
  auto_join: true,
  is_required: false,
  sort_order: 100,
  is_archived: false,
};

const PRESETS: { label: string; apply: Partial<ChannelFormValue> }[] = [
  { label: "全会員対象", apply: { category: "general", visibility: "public", audience: "all", post_policy: "everyone", auto_join: true } },
  { label: "お知らせ（運営のみ投稿）", apply: { category: "announcement", visibility: "public", audience: "all", post_policy: "staff", auto_join: true } },
  { label: "イベント", apply: { category: "event", visibility: "public", audience: "all", post_policy: "everyone", auto_join: false, is_required: false } },
  { label: "支援者別（馬を指定）", apply: { category: "supporters", visibility: "public", audience: "supporters", post_policy: "everyone", auto_join: true, is_required: false } },
  { label: "会員ランク別", apply: { category: "rank", visibility: "public", audience: "plans", post_policy: "everyone", auto_join: true, is_required: false } },
  {
    label: "会員専用（有料会員種別）",
    apply: { category: "general", visibility: "public", audience: "plans", audience_plan_codes: [...PAID_MEMBER_CODES], post_policy: "everyone", auto_join: true, is_required: false },
  },
  { label: "運営スタッフのみ", apply: { category: "staff", visibility: "public", audience: "staff", post_policy: "everyone", auto_join: true, is_required: false } },
  { label: "非公開（招待制）", apply: { visibility: "private", auto_join: false, is_required: false } },
];

export default function ChannelForm({
  channelId,
  initial,
  horses,
}: {
  channelId: string | null;
  initial: ChannelFormValue;
  horses: { id: string; name: string; is_supportable: boolean }[];
}) {
  const router = useRouter();
  const [v, setV] = useState<ChannelFormValue>(initial);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [horseFilter, setHorseFilter] = useState("");

  const set = <K extends keyof ChannelFormValue>(k: K, value: ChannelFormValue[K]) => setV((p) => ({ ...p, [k]: value }));
  const toggleCode = (c: MemberCode) =>
    set("audience_plan_codes", v.audience_plan_codes.includes(c) ? v.audience_plan_codes.filter((x) => x !== c) : [...v.audience_plan_codes, c]);
  const toggleHorse = (id: string) =>
    set("audience_horse_ids", v.audience_horse_ids.includes(id) ? v.audience_horse_ids.filter((x) => x !== id) : [...v.audience_horse_ids, id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (!v.name.trim()) {
      setMsg({ ok: false, text: "チャンネル名を入力してください。" });
      return;
    }
    if (v.visibility === "public" && v.audience === "plans" && v.audience_plan_codes.length === 0) {
      setMsg({ ok: false, text: "対象の会員種別を1つ以上選択してください。" });
      return;
    }
    setSaving(true);
    const payload = {
      ...v,
      name: v.name.trim(),
      description: v.description.trim() || null,
      topic: v.topic.trim() || null,
      sort_order: Number.isFinite(v.sort_order) ? Math.trunc(v.sort_order) : 0,
      ...(channelId ? {} : { is_archived: undefined }),
    };
    const res = await fetch(channelId ? `/api/admin/community/channels/${channelId}` : "/api/admin/community/channels", {
      method: channelId ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) {
      setMsg({ ok: false, text: j.error ?? "保存できませんでした。" });
      return;
    }
    if (!channelId && j.id) {
      router.push(`/admin/community/channels/${j.id}?created=1`);
      router.refresh();
      return;
    }
    setMsg({ ok: true, text: "保存しました。" });
    router.refresh();
  };

  const remove = async () => {
    if (!channelId) return;
    const typed = window.prompt(
      `チャンネル「${initial.name}」を削除すると、メッセージと添付ファイルもすべて削除され、元に戻せません。\n残したい場合は「アーカイブ」を使ってください。\n\n削除する場合はチャンネル名を入力してください。`,
    );
    if (typed === null) return;
    if (typed.trim() !== initial.name) {
      window.alert("チャンネル名が一致しません。削除を中止しました。");
      return;
    }
    setDeleting(true);
    const res = await fetch(`/api/admin/community/channels/${channelId}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setDeleting(false);
    if (!res.ok) {
      setMsg({ ok: false, text: j.error ?? "削除できませんでした。" });
      return;
    }
    router.push("/admin/community");
    router.refresh();
  };

  const filteredHorses = horses.filter((h) => !horseFilter.trim() || h.name.includes(horseFilter.trim()));

  return (
    <form onSubmit={submit} className="space-y-5">
      <section className="card space-y-3">
        <p className="text-sm font-semibold">テンプレート（選ぶと下の設定がまとめて入ります）</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="px-3 py-1.5 rounded-full border border-surface-line text-sm hover:border-brand hover:text-brand"
              onClick={() => setV((prev) => ({ ...prev, ...p.apply }))}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card space-y-4">
        <div className="grid md:grid-cols-[2fr,1fr] gap-4">
          <div>
            <label className="label" htmlFor="ch-name">
              チャンネル名 <span className="text-danger">*</span>
            </label>
            <input id="ch-name" className="input" value={v.name} maxLength={CHANNEL_NAME_MAX} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div>
            <label className="label" htmlFor="ch-cat">
              分類
            </label>
            <select id="ch-cat" className="input" value={v.category} onChange={(e) => set("category", e.target.value as ChannelCategory)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="ch-desc">
            説明
          </label>
          <textarea
            id="ch-desc"
            className="input"
            rows={3}
            value={v.description}
            maxLength={CHANNEL_DESCRIPTION_MAX}
            onChange={(e) => set("description", e.target.value)}
            placeholder="チャンネルの目的・ルールなど（会員に表示されます）"
          />
        </div>
        <div>
          <label className="label" htmlFor="ch-topic">
            トピック（ヘッダーに表示する一言）
          </label>
          <input id="ch-topic" className="input" value={v.topic} maxLength={CHANNEL_TOPIC_MAX} onChange={(e) => set("topic", e.target.value)} />
        </div>
      </section>

      <section className="card space-y-4">
        <fieldset>
          <legend className="label">公開範囲</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={v.visibility === "public"} onChange={() => set("visibility", "public")} />
              公開（対象者なら誰でも閲覧・参加できる）
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={v.visibility === "private"} onChange={() => setV((p) => ({ ...p, visibility: "private", auto_join: false, is_required: false }))} />
              非公開（招待したメンバーのみ）
            </label>
          </div>
        </fieldset>

        {v.visibility === "public" ? (
          <fieldset>
            <legend className="label">対象者</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {(Object.keys(AUDIENCE_LABELS) as ChannelAudience[]).map((a) => (
                <label key={a} className="flex items-center gap-2">
                  <input type="radio" checked={v.audience === a} onChange={() => set("audience", a)} />
                  {AUDIENCE_LABELS[a]}
                </label>
              ))}
            </div>

            {v.audience === "plans" && (
              <div className="mt-3 rounded border border-surface-line p-3 space-y-2">
                <p className="text-xs text-ink-mute">
                  選んだ会員種別のいずれかをお持ちの会員が参加できます（契約中・決済確認中を含む）。解約すると自動的に閲覧できなくなります。
                </p>
                <div className="grid sm:grid-cols-2 gap-1.5 text-sm">
                  {MEMBER_CODES.map((c) => (
                    <label key={c} className="flex items-center gap-2">
                      <input type="checkbox" checked={v.audience_plan_codes.includes(c)} onChange={() => toggleCode(c)} />
                      {MEMBER_CODE_LABELS[c]}
                    </label>
                  ))}
                </div>
                <div className="flex gap-2 text-xs">
                  <button type="button" className="text-brand underline" onClick={() => set("audience_plan_codes", [...PAID_MEMBER_CODES])}>
                    有料会員種別をすべて選択
                  </button>
                  <button type="button" className="text-brand underline" onClick={() => set("audience_plan_codes", [])}>
                    選択を解除
                  </button>
                </div>
              </div>
            )}

            {v.audience === "supporters" && (
              <div className="mt-3 rounded border border-surface-line p-3 space-y-2">
                <p className="text-xs text-ink-mute">
                  選んだ馬を支援中（一口支援・特別チーム）の会員が参加できます。馬を選ばない場合は「いずれかの馬を支援中の会員」全員が対象です。
                </p>
                <input className="input" placeholder="馬名で絞り込み" value={horseFilter} onChange={(e) => setHorseFilter(e.target.value)} />
                <div className="max-h-60 overflow-y-auto grid sm:grid-cols-2 gap-1 text-sm">
                  {filteredHorses.map((h) => (
                    <label key={h.id} className="flex items-center gap-2">
                      <input type="checkbox" checked={v.audience_horse_ids.includes(h.id)} onChange={() => toggleHorse(h.id)} />
                      {h.name}
                      {!h.is_supportable && <span className="text-[10px] text-ink-mute">（募集停止）</span>}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-ink-soft">選択中: {v.audience_horse_ids.length}頭</p>
              </div>
            )}
          </fieldset>
        ) : (
          <p className="text-sm text-ink-soft rounded bg-surface-soft p-3">
            非公開チャンネルは、保存後に表示される「メンバー」欄で会員を追加します。運営は常に閲覧できます。
          </p>
        )}

        <fieldset>
          <legend className="label">投稿できる人</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={v.post_policy === "everyone"} onChange={() => set("post_policy", "everyone")} />
              参加者全員
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={v.post_policy === "staff"} onChange={() => set("post_policy", "staff")} />
              運営のみ（会員はスレッド返信・リアクションのみ）
            </label>
          </div>
        </fieldset>

        {v.visibility === "public" && (
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={v.auto_join}
                onChange={(e) => setV((p) => ({ ...p, auto_join: e.target.checked, is_required: e.target.checked ? p.is_required : false }))}
              />
              <span>
                対象者全員のサイドバーに自動で表示する（自動参加）
                <span className="block text-xs text-ink-mute">オフにすると、会員は「チャンネルを探す」から自分で参加します。</span>
              </span>
            </label>
            <label className={`flex items-start gap-2 ${v.auto_join ? "" : "opacity-50"}`}>
              <input type="checkbox" className="mt-1" disabled={!v.auto_join} checked={v.is_required} onChange={(e) => set("is_required", e.target.checked)} />
              <span>退出できないようにする（お知らせなど全員必須のチャンネル）</span>
            </label>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="ch-sort">
              並び順（小さいほど上）
            </label>
            <input
              id="ch-sort"
              type="number"
              className="input"
              value={Number.isFinite(v.sort_order) ? v.sort_order : 0}
              onChange={(e) => set("sort_order", Number(e.target.value))}
            />
          </div>
          {channelId && (
            <label className="flex items-center gap-2 text-sm self-end pb-3">
              <input type="checkbox" checked={v.is_archived} onChange={(e) => set("is_archived", e.target.checked)} />
              アーカイブする（閲覧のみ・新規投稿不可）
            </label>
          )}
        </div>
      </section>

      {msg && <p className={`text-sm ${msg.ok ? "text-green-700" : "text-danger"}`}>{msg.text}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary !px-6 !py-2.5" disabled={saving}>
          {saving ? "保存中…" : channelId ? "変更を保存" : "チャンネルを作成"}
        </button>
        {channelId && (
          <button type="button" className="ml-auto text-sm text-danger underline" onClick={remove} disabled={deleting}>
            {deleting ? "削除中…" : "チャンネルを削除"}
          </button>
        )}
      </div>
    </form>
  );
}
