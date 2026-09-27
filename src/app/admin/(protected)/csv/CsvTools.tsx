"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  exportHref: string;
  exportLabel: string;
  importHref?: string;
  importLabel?: string;
  downloadName?: string;
  supportsImport?: boolean;
};

export default function CsvTools({
  exportHref,
  exportLabel,
  importHref,
  importLabel = "CSVを取込む",
  downloadName,
  supportsImport = false,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !importHref) return;
    setBusy(true);
    setResult(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(importHref, { method: "POST", body: fd });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    e.target.value = "";
    if (!res.ok) {
      setResult(`エラー：${j.error ?? "取込に失敗しました"}`);
      return;
    }
    const errCount = Array.isArray(j.errors) ? j.errors.length : 0;
    setResult(
      `取込完了：新規 ${j.created ?? 0} 件、更新 ${j.updated ?? 0} 件、エラー ${errCount} 件` +
        (errCount > 0 ? `\n${(j.errors as string[]).slice(0, 5).join("\n")}` : ""),
    );
    router.refresh();
  };

  return (
    <div className="flex flex-wrap gap-3">
      <a className="btn-primary" href={exportHref} download={downloadName}>
        {exportLabel}
      </a>
      {supportsImport && importHref && (
        <label className="btn-secondary cursor-pointer">
          {busy ? "取込中..." : importLabel}
          <input type="file" accept=".csv" className="hidden" onChange={upload} />
        </label>
      )}
      {result && <pre className="w-full text-xs mt-2 whitespace-pre-wrap">{result}</pre>}
    </div>
  );
}
