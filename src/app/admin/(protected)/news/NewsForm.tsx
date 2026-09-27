"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { isoToJstLocalInput, jstLocalInputToIso } from "@/lib/datetimeLocal";

const RichTextEditor = dynamic(() => import("@/components/admin/RichTextEditor"), { ssr: false });

const TAG_PRESETS = [
  { tag: "お知らせ", color: "bg-brand-50 text-brand-dark" },
  { tag: "イベント", color: "bg-amber-50 text-amber-800" },
  { tag: "リリース", color: "bg-blue-50 text-blue-700" },
  { tag: "メディア", color: "bg-purple-50 text-purple-700" },
];

type FileEntry = { url: string; name: string };

export default function NewsForm({ initial, id }: { initial?: any; id?: string }) {
  const router = useRouter();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  const start = initial
    ? { ...initial, published_at: isoToJstLocalInput(initial.published_at) }
    : {
        title: "",
        body: "",
        tag: "お知らせ",
        tag_color: "bg-brand-50 text-brand-dark",
        image_url: "",
        published_at: "",
        is_published: true,
        public_access: "public",
        sort_order: 0,
        pdf_url: "",
        pdf_urls: [],
        pdf_names: [],
        image_urls: [],
      };

  const [form, setForm] = useState<any>({
    ...start,
    pdf_url: start.pdf_url ?? "",
    pdf_urls: Array.isArray(start.pdf_urls) ? start.pdf_urls : [],
    pdf_names: Array.isArray(start.pdf_names) ? start.pdf_names : [],
    image_urls: Array.isArray(start.image_urls) ? start.image_urls : [],
  });

  // PDF entries: pdf_urls + pdf_names (same order), plus legacy single pdf_url fallback
  const [pdfs, setPdfs] = useState<FileEntry[]>(() => {
    const urls: string[] = Array.isArray(start.pdf_urls) ? start.pdf_urls : [];
    const names: string[] = Array.isArray(start.pdf_names) ? start.pdf_names : [];
    const entries: FileEntry[] = urls
      .filter((u: string) => Boolean(u))
      .map((u: string, i: number) => ({ url: u, name: names[i] || u.split("/").pop() || "PDF" }));
    if (start.pdf_url && !urls.includes(start.pdf_url)) {
      entries.unshift({ url: start.pdf_url, name: "添付PDF" });
    }
    return entries;
  });
  const [images, setImages] = useState<FileEntry[]>(() =>
    (Array.isArray(start.image_urls) ? start.image_urls : []).map((u: string) => ({
      url: u,
      name: u.split("/").pop() ?? "画像",
    }))
  );

  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);
  const [imgMsg, setImgMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const set = (k: string) => (e: any) =>
    setForm((p: any) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));

  /* PDF アップロード */
  const handlePdfChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfBusy(true);
    setPdfMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/news/upload", { method: "POST", body: fd });
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

  /* 画像アップロード */
  const handleImgChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImgBusy(true);
    setImgMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/news/upload-image", { method: "POST", body: fd });
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

  /* フォーム保存 */
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);

    // Serialize pdfs: first entry → pdf_url (legacy), all → pdf_urls/pdf_names
    const allPdfUrls = pdfs.map((p) => p.url);
    const payload = {
      ...form,
      published_at: jstLocalInputToIso(form.published_at) ?? undefined,
      sort_order: Number(form.sort_order),
      pdf_url: allPdfUrls[0] ?? null,
      pdf_urls: allPdfUrls,
      pdf_names: pdfs.map((p) => p.name),
      image_urls: images.map((img) => img.url),
    };

    const res = await fetch(id ? `/api/admin/news/${id}` : "/api/admin/news", {
      method: id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setMsg(j.error ?? "保存できませんでした。");
      return;
    }
    setMsg("保存しました。");
    if (!id) {
      setForm({ ...start, pdf_url: "", pdf_urls: [], image_urls: [] });
      setPdfs([]);
      setImages([]);
    }
    router.refresh();
  };

  return (
    <form onSubmit={save} className="card space-y-4">
      <div className="grid md:grid-cols-4 gap-3">
        {/* タイトル */}
        <div className="md:col-span-3">
          <label className="label">タイトル</label>
          <input className="input" value={form.title} onChange={set("title")} required maxLength={200} />
        </div>

        {/* タグ */}
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

      {/* 本文（リッチテキスト） */}
      <div>
        <label className="label">本文（書式・リンク設定可）</label>
        <RichTextEditor
          value={form.body ?? ""}
          onChange={(html) => setForm((p: any) => ({ ...p, body: html }))}
          placeholder="本文を入力…  見出し・色・リンクなどを自由に設定できます。"
          minHeight={200}
        />
        <p className="text-xs text-ink-mute mt-1">H1/H2/H3 で見出し、A で文字色、🔗 でリンクを設定できます。</p>
      </div>

      {/* 画像URL + 公開日時 + 表示順 */}
      <div className="grid md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <label className="label">カバー画像URL（任意）</label>
          <input
            className="input"
            value={form.image_url ?? ""}
            onChange={set("image_url")}
            placeholder="https://images.unsplash.com/..."
          />
        </div>
        <div>
          <label className="label">公開日時</label>
          <input
            type="datetime-local"
            className="input"
            value={form.published_at}
            onChange={(e) => setForm((p: any) => ({ ...p, published_at: e.target.value }))}
          />
        </div>
        <div>
          <label className="label">表示順</label>
          <input type="number" className="input" value={form.sort_order} onChange={set("sort_order")} min={0} />
        </div>
      </div>

      {/* 本文内追加画像（複数） */}
      <div className="border border-surface-line rounded-xl p-4 space-y-2 bg-surface-soft/50">
        <p className="label !mb-0">本文追加画像（複数可・最大20枚）</p>
        <p className="text-xs text-ink-mute">アップロードした画像は本文の下に順番に表示されます。最大10MB。</p>

        {images.length > 0 && (
          <div className="space-y-1">
            {images.map((img, idx) => (
              <div key={idx} className="flex items-center gap-3 text-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt={img.name} className="w-12 h-12 object-cover rounded border border-surface-line shrink-0" />
                <span className="flex-1 truncate text-ink-soft">{img.name}</span>
                <button
                  type="button"
                  className="text-danger text-xs underline shrink-0"
                  onClick={() => removeImage(idx)}
                >
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
          {imgMsg && (
            <p className={`text-xs ${imgMsg.includes("失敗") ? "text-danger" : "text-ok"}`}>{imgMsg}</p>
          )}
        </div>
      </div>

      {/* PDF 添付（複数・最大80枚） */}
      <div className="border border-surface-line rounded-xl p-4 space-y-2 bg-surface-soft/50">
        <p className="label !mb-0">PDF添付（複数可・最大80枚）</p>
        <p className="text-xs text-ink-mute">
          会員ページのニュース詳細にPDFダウンロードリンクが表示されます。最大20MB。
        </p>

        {pdfs.length > 0 && (
          <div className="space-y-1">
            {pdfs.map((pdf, idx) => (
              <div key={idx} className="flex items-center gap-3 text-sm">
                <span className="text-xl shrink-0">📄</span>
                <a
                  href={pdf.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand underline flex-1 truncate"
                >
                  {pdf.name}
                </a>
                <button
                  type="button"
                  className="text-danger text-xs underline shrink-0"
                  onClick={() => removePdf(idx)}
                >
                  削除
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pdfBusy || pdfs.length >= 80}
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
          {pdfMsg && (
            <p className={`text-xs ${pdfMsg.includes("失敗") ? "text-danger" : "text-ok"}`}>{pdfMsg}</p>
          )}
        </div>
      </div>

      {/* 公開チェック */}
      <label className="flex items-center gap-2">
        <input type="checkbox" className="w-5 h-5" checked={Boolean(form.is_published)} onChange={set("is_published")} />
        <span>公開する</span>
      </label>

      {/* 公開範囲 */}
      <div>
        <label className="label">公開範囲</label>
        <div className="flex items-center gap-5">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="public_access"
              className="w-4 h-4"
              checked={form.public_access !== "members_only"}
              onChange={() => setForm((p: any) => ({ ...p, public_access: "public" }))}
            />
            <span>全体公開</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="public_access"
              className="w-4 h-4"
              checked={form.public_access === "members_only"}
              onChange={() => setForm((p: any) => ({ ...p, public_access: "members_only" }))}
            />
            <span>会員限定</span>
          </label>
        </div>
        <p className="text-xs text-ink-mute mt-1">「会員限定」を選択すると、ログイン中の会員のうち、プラン未加入（空白）の会員を除いて閲覧できます。</p>
      </div>

      {msg && <p className={`text-sm ${msg === "保存しました。" ? "text-ok" : "text-danger"}`}>{msg}</p>}

      <button className="btn-primary" disabled={busy}>
        {busy ? "保存中..." : id ? "保存する" : "ニュースを登録"}
      </button>
    </form>
  );
}
