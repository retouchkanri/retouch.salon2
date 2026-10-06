"use client";

import { useEffect, type ReactNode, type SyntheticEvent } from "react";

/**
 * 印刷しようとしても中身を出さない。body の子を全部消し、案内だけを出す。
 * visibility で隠すと、transition の付いた枠が印刷に残ることがあるので display で消す。
 */
const PRINT_BLOCK = `@media print {
  body > * { display: none !important; }
  body::before { content: "この報告は印刷・保存できません。会員ページでご覧ください。"; display: block; padding: 32px; font-size: 14px; }
}`;

/**
 * 会員向けの報告を「見るだけ」にする。文字の選択、コピー、右クリック、ドラッグ、印刷、保存の操作を止める。
 * 止められるのはブラウザの通常の操作まで。画面の撮影は止められない。
 */
export default function ViewOnly({ children }: { children: ReactNode }) {
  useEffect(() => {
    // 印刷（P）と保存（S）はページ全体の操作なので、どこにフォーカスがあっても止める。
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "p" || key === "s") event.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const block = (event: SyntheticEvent) => event.preventDefault();

  return (
    <div
      onCopy={block}
      onCut={block}
      onContextMenu={block}
      onDragStart={block}
      style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
    >
      {/* 中の引用符を React が書き換えないよう、固定の文字列をそのまま入れる。 */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_BLOCK }} />
      {children}
    </div>
  );
}
