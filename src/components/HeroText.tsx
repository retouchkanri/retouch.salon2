"use client";

import { useEffect, useState } from "react";

// Heading split into segments so the colored "Retouch" keeps its style while
// being typed out one character at a time. Line 1 then line 2.
const LINE1 = "引退競走馬と支援者をつなぐ";
const BRAND = "Retouch";
const LINE2_REST = "メンバーズサイト";
const TOTAL = LINE1.length + BRAND.length + LINE2_REST.length;

// Heading loop:
//   - 1 character every 0.15s (≈2× the previous 0.3s speed) until the full
//     sentence is shown,
//   - hold 10s after completion,
//   - then clear and restart from the beginning.
const CHAR_MS = 150;
const HOLD_MS = 10000;
const TYPE_MS = TOTAL * CHAR_MS;
const CYCLE_MS = TYPE_MS + HOLD_MS;

export default function HeroText() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - start) % CYCLE_MS), 50);
    return () => clearInterval(id);
  }, []);

  const typing = elapsed < TYPE_MS;
  const count = typing ? Math.min(TOTAL, Math.floor(elapsed / CHAR_MS)) : TOTAL;

  const l1 = LINE1.slice(0, Math.min(count, LINE1.length));
  const afterL1 = Math.max(0, count - LINE1.length);
  const brand = BRAND.slice(0, Math.min(BRAND.length, afterL1));
  const rest = LINE2_REST.slice(0, Math.max(0, afterL1 - BRAND.length));
  const lineBreak = count >= LINE1.length;

  return (
    <div className="relative z-30 flex flex-1 flex-col items-center justify-center text-center px-4 sm:px-5 pb-20 gap-4">
      {/* H1 — hero headline (primary SEO keyword target) */}
      <h1
        className="text-[clamp(1.45rem,5vw,3rem)] font-bold text-white font-serif leading-snug"
        style={{ textShadow: "0 2px 12px rgba(0,0,0,0.6), 0 1px 3px rgba(0,0,0,0.4)" }}
      >
        {/* Full text for SEO / screen readers (always present in the DOM). */}
        <span className="sr-only">
          引退競走馬と支援者をつなぐ Retouchメンバーズサイト
        </span>
        {/* Animated, typed-out visual. */}
        <span aria-hidden className="block" style={{ minHeight: "2.6em" }}>
          {l1}
          {lineBreak && <br />}
          <span className="text-brand-light">{brand}</span>
          {rest}
          {typing && (
            <span className="animate-pulse inline-block align-[-0.05em] ml-0.5 w-[2px] h-[1em] bg-white/85" />
          )}
        </span>
      </h1>

      {/* Line below: green text on a white box for clear legibility.
          Scales 0 → 1 over 2s, repeating every 10s (hero-scale-loop). */}
      <p
        className="hero-scale-loop text-brand bg-white/50 rounded-xl px-5 py-3 shadow-lg text-[clamp(0.8rem,2.5vw,1rem)] max-w-xl leading-relaxed"
      >
        ここから始まる、人と馬が支え合う未来。Retouchメンバー
        <br />
        様の力で、馬たちに新たな役割を。
      </p>
    </div>
  );
}
