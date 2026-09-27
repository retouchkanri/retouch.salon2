"use client";

import { useState, useEffect } from "react";
import m1 from "@/assets/images/m1.png";
import m2 from "@/assets/images/m2.png";
import m3 from "@/assets/images/m3.png";
import m4 from "@/assets/images/m4.png";
import Image, { StaticImageData } from "next/image";

const principles: {
  num: string;
  title: string;
  body: string;
  img: StaticImageData;
}[] = [
  {
    num: "01",
    title: "透明性の確保",
    body: "すべての支援金の使途を年次報告書で公開しています。飼料費・獣医療費・牧場運営費など費目別の内訳を明示し、会員の皆さまが「自分の支援がどこに届いているか」を常に確認できる透明な運営を徹底しています。",
    img: m1,
  },
  {
    num: "02",
    title: "テクノロジーで支援をつなぐ",
    body: "オンライン決済・会員管理・レポートシステムを一元化し、全国どこからでも引退馬支援に参加できるプラットフォームを構築しています。デジタル化により事務コストを最小化し、より多くのリソースを馬たちのケアに充てることができます。",
    img: m2,
  },
  {
    num: "03",
    title: "馬の福祉を最優先に",
    body: "引退競走馬一頭一頭の健康状態・生活環境を最優先に考え、専門獣医師・ファームスタッフと密に連携した適切なケアを提供しています。大阪府河内長野市のホースレストを拠点に、馬が穏やかに暮らせる環境づくりに取り組んでいます。",
    img: m3,
  },
  {
    num: "04",
    title: "持続可能な支援の仕組み",
    body: "単発的な寄付に頼らず、月次の継続支援サブスクリプションと地域コミュニティとの連携により、長期的・安定的な支援体制を実現しています。牧場見学会・ふれあいイベントを通じて、支援者と馬たちの絆を深め、支援の継続につなげています。",
    img: m4,
  },
];

const FAN_ANGLES = [-12, -4, 4, 12];

export default function BusinessPrinciplesDeck() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [modalIndex, setModalIndex] = useState<number | null>(null);

  useEffect(() => {
    if (modalIndex !== null) return;
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % principles.length);
    }, 5000);
    return () => clearInterval(timer);
  }, [modalIndex]);

  useEffect(() => {
    if (modalIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModalIndex(null);
    };
    document.addEventListener("keydown", handler);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handler);
      document.body.style.overflow = "";
    };
  }, [modalIndex]);

  return (
    <>
      {/* ── Card Deck ── */}
      <div
        className="relative mx-auto w-[280px] sm:w-[300px]"
        style={{ height: 360 }}
      >
        {principles.map((p, i) => {
          const isActive = i === activeIndex;
          const activate = () =>
            isActive ? setModalIndex(i) : setActiveIndex(i);

          return (
            <div
              key={p.num}
              className="absolute inset-x-0 bottom-0 transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
              style={{
                transformOrigin: "50% 100%",
                transform: `rotate(${FAN_ANGLES[i]}deg) translateY(${isActive ? -30 : 0}px) scale(${isActive ? 1.05 : 0.95})`,
                zIndex: isActive ? 40 : 10 + i,
              }}
            >
              <div className="relative">
                <div
                  className={`bg-white overflow-hidden rounded-lg transition-shadow duration-500 ${
                    isActive
                      ? "shadow-2xl ring-2 ring-brand/40"
                      : "shadow-md border border-surface-line"
                  }`}
                >
                  <Image
                    src={p.img}
                    alt={p.title}
                    className="w-full h-auto"
                  />
                  <div className="p-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-brand font-bold text-xs tracking-widest">
                        {p.num}
                      </span>
                      <div className="flex-1 h-px bg-brand-100" />
                    </div>
                    <h3 className="font-bold text-base text-ink mb-2 font-serif">
                      {p.title}
                    </h3>
                    <p className="text-xs text-ink-soft leading-relaxed line-clamp-3">
                      {p.body}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`${p.title}の詳細を見る`}
                  onClick={activate}
                  className="absolute top-1/4 left-1/4 z-10 h-1/2 w-1/2 cursor-pointer rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Indicator Dots ── */}
      <div className="flex justify-center gap-2 mt-6">
        {principles.map((_, i) => (
          <button
            key={i}
            onClick={() => setActiveIndex(i)}
            aria-label={`カード ${i + 1}`}
            className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
              i === activeIndex
                ? "bg-brand scale-125"
                : "bg-brand/25 hover:bg-brand/40"
            }`}
          />
        ))}
      </div>

      {/* ── Modal ── */}
      {modalIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/60 backdrop-blur-sm animate-[fadeIn_200ms_ease]"
          onClick={() => setModalIndex(null)}
        >
          <div
            className="relative overflow-hidden rounded-xl w-full max-w-lg animate-[scaleIn_300ms_ease]"
            style={{ padding: 3 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Clockwise spinning border */}
            <div
              className="absolute deck-border-spin"
              style={{
                top: "-50%",
                left: "-50%",
                width: "200%",
                height: "200%",
                background:
                  "conic-gradient(from 0deg, #2d6a4f, #95d5b2 15%, transparent 25%, transparent 75%, #95d5b2 85%, #2d6a4f)",
              }}
            />

            {/* Card content */}
            <div className="relative z-10 bg-white rounded-md overflow-hidden">
                <Image
                src={principles[modalIndex].img}
                alt={principles[modalIndex].title}
                className="w-full h-auto"
              />
              <div className="p-6 sm:p-8">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-brand font-bold text-sm tracking-widest">
                    {principles[modalIndex].num}
                  </span>
                  <div className="flex-1 h-px bg-brand-100" />
                </div>
                <h3 className="font-bold text-xl sm:text-2xl text-ink mb-4 font-serif">
                  {principles[modalIndex].title}
                </h3>
                <p className="text-sm text-ink-soft leading-relaxed">
                  {principles[modalIndex].body}
                </p>
                <button
                  onClick={() => setModalIndex(null)}
                  className="mt-6 btn-secondary"
                >
                  閉じる
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
