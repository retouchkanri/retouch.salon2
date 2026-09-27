"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PreviewLine = {
  email: string;
  fullName: string;
  customer: "create" | "update" | "skip";
  contract: "create" | "reuse" | "none";
  supportsCreated: number;
  supportsUpdated: number;
  notes: string[];
};

type ApiResult = {
  ok: boolean;
  dryRun: boolean;
  totals?: { sourceRows: number; uniqueCustomers: number; droppedRows: number };
  created?: number;
  updated?: number;
  contractsCreated?: number;
  supportsCreated?: number;
  supportsUpdated?: number;
  horsesCreated?: number;
  errors?: string[];
  warnings?: string[];
  preview?: PreviewLine[];
  error?: string;
};

/**
 * Two-step migration UI for the management spreadsheet CSV:
 *   1. "プレビュー" runs the import with dry_run=1 and shows what would happen.
 *   2. "本番取込" re-uploads the same file and commits the changes.
 *
 * Keeping the chosen file in a ref means the user doesn't have to pick the
 * file twice.
 */
export default function LegacyMigrationTool() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);

  const run = async (dryRun: boolean) => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setResult({ ok: false, dryRun, error: "CSVファイルを選択してください" });
      return;
    }
    setBusy(dryRun ? "preview" : "commit");
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    if (dryRun) fd.append("dry_run", "1");
    try {
      const res = await fetch("/api/admin/csv/legacy", {
        method: "POST",
        body: fd,
      });
      const json = (await res.json().catch(() => ({}))) as ApiResult;
      json.ok = res.ok;
      setResult(json);
      if (!dryRun && res.ok) router.refresh();
    } catch (e: any) {
      setResult({ ok: false, dryRun, error: e?.message ?? "通信エラー" });
    } finally {
      setBusy(null);
    }
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileName(e.target.files?.[0]?.name ?? null);
    setResult(null);
  };

  const reset = () => {
    if (fileRef.current) fileRef.current.value = "";
    setFileName(null);
    setResult(null);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="btn-secondary cursor-pointer">
          {fileName ? "ファイル変更" : "CSVを選択"}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onPick}
          />
        </label>
        {fileName && (
          <span className="text-sm text-ink-soft truncate max-w-xs">
            {fileName}
          </span>
        )}
        <button
          className="btn-secondary"
          disabled={!fileName || busy !== null}
          onClick={() => run(true)}
          type="button"
        >
          {busy === "preview" ? "プレビュー中..." : "プレビュー（dry-run）"}
        </button>
        <button
          className="btn-primary"
          disabled={!fileName || busy !== null}
          onClick={() => run(false)}
          type="button"
        >
          {busy === "commit" ? "取込中..." : "本番取込を実行"}
        </button>
        {(fileName || result) && (
          <button
            className="text-sm underline text-ink-soft"
            onClick={reset}
            type="button"
          >
            クリア
          </button>
        )}
      </div>

      {result && <ResultPanel result={result} />}
    </div>
  );
}

function ResultPanel({ result }: { result: ApiResult }) {
  if (!result.ok) {
    return (
      <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm">
        <p className="font-bold text-rose-700">
          取込に失敗しました
        </p>
        <p className="mt-1">{result.error ?? "不明なエラー"}</p>
        {result.warnings && result.warnings.length > 0 && (
          <ul className="mt-2 list-disc list-inside text-xs">
            {result.warnings.slice(0, 10).map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const tone = result.dryRun
    ? "border-amber-300 bg-amber-50"
    : "border-emerald-300 bg-emerald-50";
  const heading = result.dryRun ? "プレビュー結果（未保存）" : "取込完了";

  return (
    <div className={`rounded border p-3 text-sm ${tone}`}>
      <p className="font-bold">{heading}</p>
      <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Stat label="読込行" value={result.totals?.sourceRows ?? 0} />
        <Stat label="ユニーク顧客" value={result.totals?.uniqueCustomers ?? 0} />
        <Stat label="新規顧客" value={result.created ?? 0} />
        <Stat label="更新顧客" value={result.updated ?? 0} />
        <Stat label="契約 新規" value={result.contractsCreated ?? 0} />
        <Stat label="支援 新規" value={result.supportsCreated ?? 0} />
        <Stat label="支援 更新" value={result.supportsUpdated ?? 0} />
        <Stat label="馬 新規" value={result.horsesCreated ?? 0} />
      </div>

      {result.warnings && result.warnings.length > 0 && (
        <details className="mt-2 text-xs" open={result.warnings.length <= 5}>
          <summary className="cursor-pointer font-bold">
            警告（{result.warnings.length}件）
          </summary>
          <ul className="mt-1 list-disc list-inside max-h-40 overflow-auto">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {result.errors && result.errors.length > 0 && (
        <details className="mt-2 text-xs" open>
          <summary className="cursor-pointer font-bold text-rose-700">
            エラー（{result.errors.length}件）
          </summary>
          <ul className="mt-1 list-disc list-inside max-h-40 overflow-auto">
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      {result.preview && result.preview.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer font-bold">
            行ごとの結果（先頭 {result.preview.length} 件）
          </summary>
          <div className="mt-1 max-h-60 overflow-auto">
            <table className="w-full text-xs">
              <thead className="text-left">
                <tr>
                  <th className="pr-2">氏名</th>
                  <th className="pr-2">メール</th>
                  <th className="pr-2">顧客</th>
                  <th className="pr-2">契約</th>
                  <th className="pr-2">支援 新/更</th>
                </tr>
              </thead>
              <tbody>
                {result.preview.map((p, i) => (
                  <tr key={i} className="border-t border-amber-200/50">
                    <td className="pr-2">{p.fullName}</td>
                    <td className="pr-2">{p.email}</td>
                    <td className="pr-2">{p.customer}</td>
                    <td className="pr-2">{p.contract}</td>
                    <td className="pr-2">
                      {p.supportsCreated}/{p.supportsUpdated}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-white/60 px-2 py-1">
      <div className="text-ink-soft">{label}</div>
      <div className="font-bold text-base">{value}</div>
    </div>
  );
}
