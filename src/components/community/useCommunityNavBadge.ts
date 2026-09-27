"use client";

import { useEffect, useRef, useState } from "react";
import { unreadSummary } from "@/lib/community/api";
import type { UnreadSummary } from "@/lib/community/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Listener = (s: UnreadSummary | null) => void;
type BumpListener = (s: UnreadSummary) => void;

let cached: UnreadSummary | null = null;
let listeners = new Set<Listener>();
let bumpListeners = new Set<BumpListener>();
let started = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let channel: ReturnType<ReturnType<typeof getSupabaseBrowserClient>["channel"]> | null = null;
let lastBadge: number | null = null;

function emit(s: UnreadSummary | null) {
  cached = s;
  listeners.forEach((fn) => fn(s));
}

async function refresh(announce: boolean) {
  try {
    const s = await unreadSummary(getSupabaseBrowserClient());
    const prev = lastBadge;
    if (s) lastBadge = s.badge;
    emit(s);
    if (announce && s && prev != null && s.badge > prev) {
      bumpListeners.forEach((fn) => fn(s));
    }
  } catch {
    emit(null);
  }
}

function onFocus() {
  void refresh(true);
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  void refresh(false);

  pollTimer = setInterval(() => void refresh(true), 60_000);
  window.addEventListener("focus", onFocus);

  const db = getSupabaseBrowserClient();
  channel = db
    .channel("community-nav-shared")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "community_messages" }, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => void refresh(true), 1500);
    })
    .subscribe();
}

function stopIfIdle() {
  if (listeners.size > 0) return;
  started = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  window.removeEventListener("focus", onFocus);
  if (channel) {
    void getSupabaseBrowserClient().removeChannel(channel);
    channel = null;
  }
}

/**
 * ヘッダー／FAB で共有するコミュニティ未読。
 * 利用不可（対象外）のときは null。Realtime／ポーリングは1本だけ。
 * enabled=false（コミュニティ画面を開いている間）は購読しない（画面側が未読を管理するため）。
 */
export function useCommunityNavBadge(onBump?: (s: UnreadSummary) => void, enabled = true): UnreadSummary | null {
  const [summary, setSummary] = useState<UnreadSummary | null>(cached);
  const bumpRef = useRef(onBump);
  bumpRef.current = onBump;

  useEffect(() => {
    if (!enabled) return;
    const listener: Listener = (s) => setSummary(s);
    const bumpListener: BumpListener = (s) => bumpRef.current?.(s);
    listeners.add(listener);
    bumpListeners.add(bumpListener);
    ensureStarted();
    setSummary(cached);
    return () => {
      listeners.delete(listener);
      bumpListeners.delete(bumpListener);
      stopIfIdle();
    };
  }, [enabled]);

  return summary;
}
