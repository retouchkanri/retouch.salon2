"use client";

import Link from "next/link";
import { useCommunityNavBadge } from "./useCommunityNavBadge";

/** マイページの「コミュニティ」カード。ログイン中は常に表示。 */
export default function CommunityMypageCard() {
  const summary = useCommunityNavBadge();

  return (
    <Link href="/community" className="card hover:shadow-lg transition-shadow group relative">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-brand-50 group-hover:bg-brand-100 flex items-center justify-center shrink-0 overflow-hidden p-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/comunity.png" alt="" className="w-full h-full object-contain" />
        </div>
        <div>
          <p className="text-xs text-ink-mute mb-0.5">会員専用コミュニティ</p>
          <p className="text-lg font-bold">コミュニティを開く</p>
          <p className="text-xs text-ink-soft mt-0.5">会員同士や運営とメッセージで交流できます。</p>
        </div>
      </div>
      {summary && summary.badge > 0 && (
        <span className="absolute top-3 right-3 min-w-[22px] h-[22px] px-1.5 rounded-full bg-rose-500 text-white text-xs font-bold flex items-center justify-center">
          {summary.badge > 99 ? "99+" : summary.badge}
        </span>
      )}
    </Link>
  );
}
