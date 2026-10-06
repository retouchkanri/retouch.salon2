"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** システム開始前のまとめを会員に公開する。数字は公開済みの資料のものなので、入力は補足だけ。 */
export default function LegacyPublisher({
  ym,
  note,
  publishedAt,
  tableMissing,
}: {
  ym: string;
  note: string;
  publishedAt: string | null;
  tableMissing: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"save" | "publish" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(form: HTMLFormElement, publish: boolean) {
    const data = new FormData(form);
    setPending(publish ? "publish" : "save");
    setMessage(null);
    const res = await fetch("/api/admin/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ym, publish, note: String(data.get("note") ?? "") }),
    });
    const json = await res.json().catch(() => ({}));
    setPending(null);
    if (!res.ok) {
      setMessage(typeof json.error === "string" ? json.error : "保存に失敗しました。");
      return;
    }
    setMessage(publish ? "システム開始前のまとめを会員に公開しました。" : "補足を保存しました。");
    router.refresh();
  }

  return (
    <form
      className="card no-print space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget, false);
      }}
    >
      <div>
        <h2 className="section-title">会員への公開</h2>
        <p className="text-sm text-ink-soft">
          公開すると、上の内容が会員ページの「決済報告」に固定して表示されます。数字は公開済みの資料から写したもので、この画面では変更できません。
        </p>
      </div>
      {tableMissing ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          保存用のテーブルがまだありません。Supabaseで supabase/newhorse.sql の末尾（monthly_reports）を実行すると、会員への公開が使えるようになります。
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="font-medium">会員向けの補足</span>
        <textarea name="note" defaultValue={note} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-secondary" disabled={pending != null || tableMissing}>
          {pending === "save" ? "保存中…" : "補足を保存"}
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={pending != null || tableMissing}
          onClick={(event) => void submit(event.currentTarget.form!, true)}
        >
          {pending === "publish" ? "公開中…" : publishedAt ? "この内容で再公開" : "会員に公開"}
        </button>
        <button type="button" className="btn-ghost" onClick={() => window.print()}>印刷 / PDF保存</button>
        {message ? <p className="text-sm">{message}</p> : null}
      </div>
    </form>
  );
}
