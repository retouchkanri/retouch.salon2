"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function HorseReportForm({
  horseId,
  ym,
  note,
  body,
  lifeStory,
  photos,
  publishedAt,
}: {
  horseId: string;
  ym: string;
  note: string;
  body: string;
  lifeStory: string;
  photos: string[];
  publishedAt: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(form: HTMLFormElement, mode: "save" | "generate" | "publish") {
    const data = new FormData(form);
    data.set("horseId", horseId);
    data.set("ym", ym);
    data.set("generate", mode === "generate" ? "1" : "0");
    data.set("publish", mode === "publish" ? "1" : "0");
    setPending(mode);
    setMessage(null);
    const res = await fetch("/api/admin/horse-reports", { method: "POST", body: data });
    const json = await res.json().catch(() => ({}));
    setPending(null);
    if (!res.ok) {
      setMessage(typeof json.error === "string" ? json.error : "保存に失敗しました。");
      return;
    }
    setMessage(mode === "generate" ? (json.usedAi ? "AIが下書きを作りました。内容を確認してから公開してください。" : "APIキーが使えなかったため、記録をもとに下書きを作りました。") : mode === "publish" ? "会員向けに公開しました。" : "保存しました。");
    router.refresh();
  }

  return (
    <form className="card space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget, "save"); }}>
      <label className="block text-sm">
        <span className="font-medium">スタッフの近況メモ</span>
        <textarea name="note" defaultValue={note} rows={4} className="mt-1 w-full rounded-lg border px-3 py-2" placeholder="食欲、移動、訪問時の様子など、見た事実を書いてください。" />
      </label>
      <label className="block text-sm">
        <span className="font-medium">写真を添付</span>
        <input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="mt-1 block w-full text-sm" />
      </label>
      <input type="hidden" name="existingPhotos" value={photos.join("\n")} />
      {photos.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {photos.map((url) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={url} src={url} alt="" className="h-20 w-20 rounded-lg object-cover" />
          ))}
        </div>
      ) : null}
      <label className="block text-sm">
        <span className="font-medium">今月の報告</span>
        <textarea name="body" defaultValue={body} rows={6} className="mt-1 w-full rounded-lg border px-3 py-2" />
      </label>
      <label className="block text-sm">
        <span className="font-medium">保護から今まで</span>
        <textarea name="lifeStory" defaultValue={lifeStory} rows={6} className="mt-1 w-full rounded-lg border px-3 py-2" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-secondary" disabled={pending != null}>{pending === "save" ? "保存中…" : "下書きを保存"}</button>
        <button type="button" className="btn-secondary" disabled={pending != null} onClick={(event) => void submit(event.currentTarget.form!, "generate")}>{pending === "generate" ? "作成中…" : "文章を作る"}</button>
        <button type="button" className="btn-primary" disabled={pending != null} onClick={(event) => void submit(event.currentTarget.form!, "publish")}>{pending === "publish" ? "公開中…" : publishedAt ? "この内容で再公開" : "会員に公開"}</button>
        <button type="button" className="btn-ghost" onClick={() => window.print()}>印刷 / PDF保存</button>
        {message ? <p className="text-sm">{message}</p> : null}
      </div>
    </form>
  );
}
