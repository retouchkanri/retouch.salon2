"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { sendMemberMessageUntilDone, type SendProgress } from "@/lib/memberMessagesClient";
import SendProgressBar from "./SendProgressBar";

const RichTextEditor = dynamic(() => import("@/components/admin/RichTextEditor"), { ssr: false });

const TAG_PRESETS = [
  { tag: "お知らせ", color: "bg-brand-50 text-brand-dark" },
  { tag: "イベント", color: "bg-amber-50 text-amber-800" },
  { tag: "リリース", color: "bg-blue-50 text-blue-700" },
  { tag: "メディア", color: "bg-purple-50 text-purple-700" },
];

type TargetCustomer = { id: string; full_name: string | null; email: string | null };
type FileEntry = { url: string; name: string };

const AUDIENCE_OPTIONS = [
  { value: "all", label: "全アクティブ会員" },
  { value: "class_attender", label: "アテンダー会員" },
  { value: "class_owner", label: "オーナーズ会員" },
  { value: "class_b", label: "サポーター会員" },
  { value: "class_a", label: "メンバーズ会員" },
  { value: "class_support", label: "ヘルパーズ会員" },
  { value: "class_c", label: "リェリーフ会員" },
  { value: "rpt_only", label: "リタポメンバー" },
  { value: "team_only", label: "がんがんチーム" },
  { value: "no_class", label: "空白の人のみ（無料会員）" },
  { value: "subset", label: "手動指定した人のみ" },
];

// クライアント側プレビュー用（サーバの messageBodyHtml と同等の最小実装）
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function previewHtml(body: string, format: "html" | "text"): string {
  return format === "text" ? escapeHtml(body).replace(/\r?\n/g, "<br />") : body;
}

function toLocalInput(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local はローカルタイム。タイムゾーンオフセットを引いて整形。
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export default function MemberMessageForm({
  initial,
  id,
  initialTargets,
}: {
  initial?: any;
  id?: string;
  initialTargets?: TargetCustomer[];
}) {
  const router = useRouter();
  const start = initial ?? {
    title: "",
    body: "",
    body_format: "html",
    tag: "お知らせ",
    tag_color: "bg-brand-50 text-brand-dark",
    channel_inapp: true,
    channel_email: true,
    audience: "all",
    scheduled_at: null,
  };
  const [form, setForm] = useState<any>({ ...start });
  const [audiences, setAudiences] = useState<string[]>(() =>
    Array.isArray(start.audiences) && start.audiences.length > 0
      ? start.audiences
      : start.audience
        ? [start.audience]
        : ["all"],
  );
  const toggleAudience = (value: string) => {
    setAudiences((prev) => {
      if (value === "all") return prev.includes("all") ? [] : ["all"];
      const withoutAll = prev.filter((v) => v !== "all");
      return withoutAll.includes(value)
        ? withoutAll.filter((v) => v !== value)
        : [...withoutAll, value];
    });
  };
  const [targets, setTargets] = useState<TargetCustomer[]>(initialTargets ?? []);
  const [schedule, setSchedule] = useState<string>(toLocalInput(start.scheduled_at));
  const [showPreview, setShowPreview] = useState(true);

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<TargetCustomer[]>([]);
  const [searching, setSearching] = useState(false);

  const imgInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<FileEntry[]>(() =>
    (Array.isArray(start.image_urls) ? start.image_urls : []).map((u: string) => ({
      url: u,
      name: u.split("/").pop() ?? "画像",
    })),
  );
  const [pdfs, setPdfs] = useState<FileEntry[]>(() =>
    (Array.isArray(start.pdf_urls) ? start.pdf_urls : []).map((u: string) => ({
      url: u,
      name: u.split("/").pop() ?? "PDF",
    })),
  );
  const [imgBusy, setImgBusy] = useState(false);
  const [imgMsg, setImgMsg] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // 一斉配信の進捗（送信済み / 全体）。null のあいだはバーを出さない。
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [sendDone, setSendDone] = useState(false);

  const set = (k: string) => (e: any) =>
    setForm((p: any) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  const runSearch = async (q: string) => {
    setSearch(q);
    if (q.trim().length < 1) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const res = await fetch(`/api/admin/customers/search?q=${encodeURIComponent(q)}&limit=10`);
    setSearching(false);
    if (res.ok) {
      const j = await res.json();
      setSearchResults(j.results ?? []);
    }
  };
  const addTarget = (c: TargetCustomer) => {
    setTargets((prev) => (prev.some((t) => t.id === c.id) ? prev : [...prev, c]));
    setSearch("");
    setSearchResults([]);
  };
  const removeTarget = (cid: string) => setTargets((prev) => prev.filter((t) => t.id !== cid));

  const handleImgChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgBusy(true);
    setImgMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/member-messages/upload-image", { method: "POST", body: fd });
    setImgBusy(false);
    if (imgInputRef.current) imgInputRef.current.value = "";
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setImgMsg(j.error ?? "画像のアップロードに失敗しました。");
      return;
    }
    const j = await res.json();
    setImages((prev) => [...prev, { url: j.url, name: j.name ?? file.name }]);
    setImgMsg("画像をアップロードしました。");
  };
  const removeImage = (idx: number) => setImages((prev) => prev.filter((_, i) => i !== idx));

  const handlePdfChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfBusy(true);
    setPdfMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/member-messages/upload", { method: "POST", body: fd });
    setPdfBusy(false);
    if (pdfInputRef.current) pdfInputRef.current.value = "";
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setPdfMsg(j.error ?? "PDFのアップロードに失敗しました。");
      return;
    }
    const j = await res.json();
    setPdfs((prev) => [...prev, { url: j.url, name: j.name ?? file.name }]);
    setPdfMsg("PDFをアップロードしました。");
  };
  const removePdf = (idx: number) => setPdfs((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (action: "draft" | "schedule" | "send") => {
    if (audiences.length === 0) {
      setMsg("配信対象を1つ以上選択してください。");
      return;
    }
    setBusy(true);
    setMsg(null);
    setProgress(null);
    setSendDone(false);
    const payload: any = {
      title: form.title,
      body: form.body,
      body_format: form.body_format,
      tag: form.tag,
      tag_color: form.tag_color,
      channel_inapp: form.channel_inapp,
      channel_email: form.channel_email,
      audiences,
      target_customer_ids: audiences.includes("subset") ? targets.map((t) => t.id) : [],
      image_urls: images.map((img) => img.url),
      pdf_urls: pdfs.map((pdf) => pdf.url),
    };
    if (action === "schedule") payload.scheduled_at = schedule ? new Date(schedule).toISOString() : null;

    let res: Response;
    if (id) {
      // 編集: 下書き or 予約として保存（即時配信は詳細ページの「今すぐ配信」）
      payload.status = action === "schedule" ? "scheduled" : "draft";
      res = await fetch(`/api/admin/member-messages/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } else {
      payload.action = action;
      res = await fetch("/api/admin/member-messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    }
    if (!res.ok) {
      setBusy(false);
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? "保存できませんでした。");
      return;
    }
    const j = await res.json().catch(() => ({}));
    if (!id) {
      const created = j.id as string | undefined;
      if (action === "send") {
        // サーバは最初の1バッチだけを短時間で送って返す（配信対象の materialize と
        // status='sending' への遷移はサーバ側で確定するため、この後ブラウザを閉じても
        // cron が続きを送る）。全体件数がここで判明するので進捗バーを出せる。
        const first: SendProgress = {
          sentCount: j.result?.sentCount ?? 0,
          remaining: j.result?.remaining ?? 0,
          recipientCount: j.result?.recipientCount ?? 0,
          status: j.result?.status ?? "sending",
          round: 0,
        };
        setProgress(first);

        // 残りは送信APIを繰り返し呼び出しながら、1バッチごとに進捗を更新する。
        if (created && first.remaining > 0) {
          const result = await sendMemberMessageUntilDone(created, setProgress);
          setProgress(result.progress);
          setBusy(false);
          setSendDone(result.finished);

          if (result.finished) {
            setMsg(`配信が完了しました（送信 ${result.progress.sentCount.toLocaleString("ja-JP")} 件）。`);
            // 100%（送信完了）の状態を見せてから詳細ページへ移動する。
            setTimeout(() => router.push(`/admin/member-messages/${created}`), 1200);
            return;
          }
          // 中断時は理由を読めるようこのページに留まる（自動遷移でメッセージを消さない）。
          setMsg(
            result.throttled
              ? `送信 ${result.progress.sentCount.toLocaleString("ja-JP")} 件で一時停止しました。残り ${result.progress.remaining.toLocaleString("ja-JP")} 件は未送信のまま保持されています。時間をおくと自動配信（cron）が続きを送信します。` +
                  (result.throttleReason ? `\n検知した内容: ${result.throttleReason}` : "")
              : !result.ok
                ? `${result.error ?? "配信中にエラーが発生しました。"}（送信済み ${result.progress.sentCount.toLocaleString("ja-JP")} 件。続きは配信詳細ページから再開できます）`
                : `送信 ${result.progress.sentCount.toLocaleString("ja-JP")} 件まで完了しました。残り ${result.progress.remaining.toLocaleString("ja-JP")} 件は配信詳細ページから続けられます（しばらくすると自動配信でも送信されます）。`,
          );
          return;
        }

        // 1バッチで送り切れた場合。
        setBusy(false);
        setSendDone(true);
        setMsg(`配信が完了しました（送信 ${first.sentCount.toLocaleString("ja-JP")} 件）。`);
        if (created) setTimeout(() => router.push(`/admin/member-messages/${created}`), 1200);
        return;
      }

      setBusy(false);
      setMsg(action === "schedule" ? "予約しました。" : "下書きを保存しました。");
      if (created) {
        router.push(`/admin/member-messages/${created}`);
        return;
      }
    } else {
      setBusy(false);
      setMsg("保存しました。");
    }
    router.refresh();
  };

  return (
    <div className="card space-y-4">
      <div className="grid md:grid-cols-4 gap-3">
        <div className="md:col-span-3">
          <label className="label">件名（メールの件名・お知らせのタイトル）</label>
          <input className="input" value={form.title} onChange={set("title")} maxLength={200} required />
        </div>
        <div>
          <label className="label">タグ</label>
          <select
            className="input"
            value={form.tag}
            onChange={(e) => {
              const preset = TAG_PRESETS.find((p) => p.tag === e.target.value);
              setForm((p: any) => ({ ...p, tag: e.target.value, tag_color: preset?.color ?? p.tag_color }));
            }}
          >
            {TAG_PRESETS.map((p) => (
              <option key={p.tag} value={p.tag}>{p.tag}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2">
          <input type="checkbox" className="w-5 h-5" checked={form.channel_inapp} onChange={set("channel_inapp")} />
          <span>マイページに表示（お知らせ）</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="w-5 h-5" checked={form.channel_email} onChange={set("channel_email")} />
          <span>メール配信（メルマガ）</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="label !mb-0">本文形式</span>
          <select className="input !w-auto" value={form.body_format} onChange={set("body_format")}>
            <option value="html">HTML</option>
            <option value="text">テキスト</option>
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="label">本文{form.body_format === "html" ? "（書式・リンク設定可）" : "（テキスト）"}</label>
          {form.body_format === "text" && (
            <button type="button" className="text-brand underline text-sm" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? "プレビューを隠す" : "プレビュー表示"}
            </button>
          )}
        </div>
        {form.body_format === "html" ? (
          <>
            <RichTextEditor
              value={form.body ?? ""}
              onChange={(html) => setForm((p: any) => ({ ...p, body: html }))}
              placeholder="本文を入力…　見出し・文字色・リンクなどを自由に設定できます。"
              minHeight={200}
            />
            <p className="text-xs text-ink-mute mt-1">🔗 ボタンでリンク（URL）を選択中の文字に設定できます。H1/H2/H3 で見出し、A で文字色も設定できます。</p>
          </>
        ) : (
          <>
            <textarea
              className="input font-mono text-sm"
              rows={10}
              value={form.body}
              onChange={set("body")}
              placeholder="こんにちは。今月のお知らせです。"
            />
            {showPreview && (
              <div className="mt-2 border border-surface-line rounded-lg p-4 bg-white">
                <p className="text-xs text-ink-mute mb-2">プレビュー</p>
                <div
                  className="prose prose-sm max-w-none text-[15px] leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: previewHtml(form.body ?? "", form.body_format) }}
                />
              </div>
            )}
          </>
        )}
      </div>

      <div className="space-y-2">
        <label className="label">配信対象（複数選択可）</label>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {AUDIENCE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={audiences.includes(opt.value)}
                onChange={() => toggleAudience(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
        {audiences.length === 0 && (
          <p className="text-xs text-danger">配信対象を1つ以上選択してください。</p>
        )}

        {audiences.includes("subset") && (
          <div className="space-y-2">
            <input
              className="input"
              placeholder="氏名・カナ・メールで検索して追加"
              value={search}
              onChange={(e) => runSearch(e.target.value)}
            />
            {searching && <p className="text-xs text-ink-mute">検索中...</p>}
            {searchResults.length > 0 && (
              <div className="border border-surface-line rounded-lg divide-y">
                {searchResults.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="block w-full text-left px-3 py-2 hover:bg-brand-50 text-sm"
                    onClick={() => addTarget(c)}
                  >
                    {c.full_name ?? "（無名）"}{" "}
                    <span className="text-ink-mute">{c.email ?? ""}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {targets.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1 bg-brand-50 text-brand-dark text-sm px-2 py-1 rounded-full">
                  {t.full_name ?? t.email ?? t.id}
                  <button type="button" className="text-ink-mute hover:text-ink" onClick={() => removeTarget(t.id)}>×</button>
                </span>
              ))}
              {targets.length === 0 && <span className="text-xs text-ink-mute">会員が選択されていません。</span>}
            </div>
          </div>
        )}
      </div>

      {/* 画像添付（複数可） */}
      <div className="border border-surface-line rounded-xl p-4 space-y-2 bg-surface-soft/50">
        <p className="label !mb-0">画像添付（複数可）</p>
        <p className="text-xs text-ink-mute">お知らせ・メール本文の下に表示されます。最大10MB。</p>

        {images.length > 0 && (
          <div className="space-y-1">
            {images.map((img, idx) => (
              <div key={idx} className="flex items-center gap-3 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.name} className="w-12 h-12 object-cover rounded border border-surface-line shrink-0" />
                <span className="flex-1 truncate text-ink-soft">{img.name}</span>
                <button type="button" className="text-danger text-xs underline shrink-0" onClick={() => removeImage(idx)}>
                  削除
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={imgBusy}
            onClick={() => imgInputRef.current?.click()}
            className="btn-secondary !py-2 !px-4 !text-sm"
          >
            {imgBusy ? "アップロード中…" : "＋ 画像を追加"}
          </button>
          <input
            ref={imgInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            className="hidden"
            onChange={handleImgChange}
          />
          {imgMsg && <p className={`text-xs ${imgMsg.includes("失敗") ? "text-danger" : "text-ok"}`}>{imgMsg}</p>}
        </div>
      </div>

      {/* PDF添付（複数可） */}
      <div className="border border-surface-line rounded-xl p-4 space-y-2 bg-surface-soft/50">
        <p className="label !mb-0">PDF添付（複数可）</p>
        <p className="text-xs text-ink-mute">お知らせ・メールにダウンロードリンクが表示されます。最大20MB。</p>

        {pdfs.length > 0 && (
          <div className="space-y-1">
            {pdfs.map((pdf, idx) => (
              <div key={idx} className="flex items-center gap-3 text-sm">
                <span className="text-xl shrink-0">📄</span>
                <a href={pdf.url} target="_blank" rel="noopener noreferrer" className="text-brand underline flex-1 truncate">
                  {pdf.name}
                </a>
                <button type="button" className="text-danger text-xs underline shrink-0" onClick={() => removePdf(idx)}>
                  削除
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pdfBusy}
            onClick={() => pdfInputRef.current?.click()}
            className="btn-secondary !py-2 !px-4 !text-sm"
          >
            {pdfBusy ? "アップロード中…" : "＋ PDFを追加"}
          </button>
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={handlePdfChange}
          />
          {pdfMsg && <p className={`text-xs ${pdfMsg.includes("失敗") ? "text-danger" : "text-ok"}`}>{pdfMsg}</p>}
        </div>
      </div>

      <div>
        <label className="label">予約配信日時（予約する場合のみ・日本時間）</label>
        <input
          type="datetime-local"
          className="input md:w-auto"
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
        />
      </div>

      {(progress || msg) && (
        <div className="space-y-2">
          <SendProgressBar progress={progress} done={sendDone} />
          {msg && <p className="text-sm whitespace-pre-line">{msg}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => submit("draft")}>
          {busy && !progress ? "保存中..." : "下書き保存"}
        </button>
        <button type="button" className="btn-secondary" disabled={busy || !schedule} onClick={() => submit("schedule")}>
          予約{id ? "保存" : "する"}
        </button>
        {!id && (
          <button type="button" className="btn-primary" disabled={busy} onClick={() => submit("send")}>
            {progress ? (sendDone ? "配信完了" : "配信中…") : "今すぐ配信"}
          </button>
        )}
      </div>
    </div>
  );
}
