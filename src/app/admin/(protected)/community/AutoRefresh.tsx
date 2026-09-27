"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 画面を開いている間、一定間隔でサーバーの最新データに更新する（最近の投稿の確認用）。 */
export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
