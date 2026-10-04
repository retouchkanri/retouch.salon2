"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EXPENSE_FIELDS, type ExpenseMap } from "@/lib/monthlyReport";

export default function ReportEditor({
  ym,
  expenses,
  horseCount,
  note,
  publishedAt,
  tableMissing,
}: {
  ym: string;
  expenses: ExpenseMap;
  horseCount: number | null;
  note: string;
  publishedAt: string | null;
  tableMissing: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<"save" | "publish" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(form: HTMLFormElement, publish: boolean) {
    const data = new FormData(form);
    const body = {
      ym,
      publish,
      note: String(data.get("note") ?? ""),
      horseCount: String(data.get("horseCount") ?? "").trim() === "" ? null : Number(data.get("horseCount")),
      expenses: Object.fromEntries(EXPENSE_FIELDS.map((field) => [field.key, Number(data.get(field.key) || 0)])),
    };
    setPending(publish ? "publish" : "save");
    setMessage(null);
    const res = await fetch("/api/admin/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    setPending(null);
    if (!res.ok) {
      setMessage(typeof json.error === "string" ? json.error : "保存に失敗しました。");
      return;
    }
    setMessage(publish ? "会員向けの収支報告を公開しました。" : "下書きを保存しました。");
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
        <h2 className="section-title">運営経費と公開</h2>
        <p className="text-sm text-ink-soft">
          入力した内訳は、収入の20%として自動計算した運営経費の内訳です。公開すると、その時点の数字が会員向けレポートに固定されます。
        </p>
      </div>
      {tableMissing ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          保存用のテーブルがまだありません。Supabaseで supabase/newhorse.sql の末尾（monthly_reports）を実行すると、下書き保存と会員への公開が使えるようになります。画面の集計自体はこのままで確認できます。
        </p>
      ) : null}
      <label className="block text-sm">
        <span className="font-medium">預託中の頭数（空欄なら、故と記載のない馬の数）</span>
        <input name="horseCount" type="number" min={0} defaultValue={horseCount ?? ""} className="mt-1 w-40 rounded-lg border px-3 py-2" />
      </label>
      <div className="grid md:grid-cols-2 gap-3">
        {EXPENSE_FIELDS.map((field) => (
          <label key={field.key} className="block text-sm">
            <span className="font-medium">{field.label}</span>
            <span className="mt-0.5 block text-xs text-ink-mute">{field.hint}</span>
            <input name={field.key} type="number" min={0} defaultValue={expenses[field.key] || ""} className="mt-1 w-full rounded-lg border px-3 py-2" />
          </label>
        ))}
      </div>
      <label className="block text-sm">
        <span className="font-medium">会員向けの補足</span>
        <textarea name="note" defaultValue={note} rows={3} className="mt-1 w-full rounded-lg border px-3 py-2" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-secondary" disabled={pending != null || tableMissing}>
          {pending === "save" ? "保存中…" : "下書きを保存"}
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
