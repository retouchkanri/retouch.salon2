"use client";

import Link from "next/link";
import { useState } from "react";
import { formatUnits } from "@/lib/format";
import type { CustomerNames } from "@/lib/customerNames";
import type { SupportMover } from "@/lib/donationInsight";

/**
 * 口数が動いた人の一覧。名前を押すと、その人の顧客情報が開く。
 * mode="stopped" は、停止した支援の一覧（馬の名前と、停止した口数を出す）。
 * showHorse は、馬の名前も出すとき（馬ごとの見出しの下に並べないとき）。
 */
export default function MoverList({
  movers,
  names,
  mode = "delta",
  showHorse = false,
  limit = 5,
  className = "",
}: {
  movers: SupportMover[];
  names: CustomerNames;
  mode?: "delta" | "stopped";
  showHorse?: boolean;
  limit?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (movers.length === 0) return null;
  const shown = open ? movers : movers.slice(0, limit);
  const rest = movers.length - shown.length;

  return (
    <ul className={`space-y-1 text-xs ${className}`}>
      {shown.map((mover, index) => {
        const person = names[mover.customerId];
        const units = formatUnits(Math.abs(mover.deltaUnits));
        return (
          <li key={`${mover.customerId}-${mover.horseId}-${index}`} className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 leading-snug">
              <Link href={`/admin/customers/${mover.customerId}`} className="font-medium text-brand underline underline-offset-2 hover:text-brand-dark">
                {person?.name || "（お名前の登録なし）"}
              </Link>
              {person?.nickname ? <span className="text-black/55">（{person.nickname}）</span> : null}
              {showHorse || mode === "stopped" ? <span className="block text-black/55">{mover.horseName}</span> : null}
            </span>
            <span className="shrink-0 whitespace-nowrap tabular-nums text-black/60">
              {mode === "stopped"
                ? `${units} 停止${mover.keptUnits ? `（残り ${formatUnits(mover.keptUnits)}）` : ""}`
                : `${mover.deltaUnits > 0 ? "+" : "−"}${units}`}
            </span>
          </li>
        );
      })}
      {rest > 0 ? (
        <li>
          <button type="button" onClick={() => setOpen(true)} className="text-black/55 underline underline-offset-2 hover:text-black/80">
            ほか {rest.toLocaleString("ja-JP")}件を表示
          </button>
        </li>
      ) : null}
    </ul>
  );
}
