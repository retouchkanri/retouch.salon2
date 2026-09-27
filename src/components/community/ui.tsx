"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Message } from "@/lib/community/types";

export type DetailsTab = "about" | "members" | "settings";

export type ModalState =
  | { type: "profile" }
  | { type: "directory" }
  | { type: "browse" }
  | { type: "create"; visibility?: "public" | "private" }
  | { type: "details"; channelId: string; tab?: DetailsTab }
  | { type: "invite"; channelId: string }
  | { type: "search"; channelId: string | null }
  | { type: "pinned"; channelId: string }
  | { type: "report"; message: Message }
  | { type: "user"; userId: string }
  | { type: "readers"; userIds: string[]; title: string }
  | null;

type Ui = {
  modal: ModalState;
  openModal: (m: Exclude<ModalState, null>) => void;
  closeModal: () => void;
};

const UiCtx = createContext<Ui | null>(null);
/** ダイアログを開く関数だけ（開閉のたびに一覧を描き直さないよう、状態とは別の Context にする） */
const OpenCtx = createContext<Ui["openModal"] | null>(null);

export function UiProvider({ children, initialModal = null }: { children: ReactNode; initialModal?: ModalState }) {
  const [modal, setModal] = useState<ModalState>(initialModal);
  const openModal = useCallback((m: Exclude<ModalState, null>) => setModal(m), []);
  const closeModal = useCallback(() => setModal(null), []);
  const value = useMemo<Ui>(() => ({ modal, openModal, closeModal }), [modal, openModal, closeModal]);
  return (
    <OpenCtx.Provider value={openModal}>
      <UiCtx.Provider value={value}>{children}</UiCtx.Provider>
    </OpenCtx.Provider>
  );
}

export function useUi(): Ui {
  const v = useContext(UiCtx);
  if (!v) throw new Error("useUi must be used inside <UiProvider>");
  return v;
}

export function useOpenModal(): Ui["openModal"] {
  const v = useContext(OpenCtx);
  if (!v) throw new Error("useOpenModal must be used inside <UiProvider>");
  return v;
}
