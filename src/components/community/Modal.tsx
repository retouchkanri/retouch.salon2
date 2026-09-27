"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "./icons";

/** Slack と同じダイアログ（スマホは下から全幅）。Esc・背景クリックで閉じる。 */
export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  wide = false,
  bodyClassName = "px-7 py-5",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  bodyClassName?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[160] flex items-end md:items-center justify-center bg-[rgba(29,28,29,0.6)] p-0 md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`w-full ${wide ? "md:max-w-[640px]" : "md:max-w-[520px]"} max-h-[92dvh] md:max-h-[85dvh] flex flex-col bg-white text-sk-text shadow-[0_18px_48px_rgba(0,0,0,0.35)] rounded-t-[12px] md:rounded-[8px] overflow-hidden`}
      >
        <div className="flex items-start justify-between gap-3 px-7 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-[22px] font-black leading-tight truncate">{title}</h2>
            {subtitle && <div className="mt-1 text-[13px] text-sk-mute">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-3 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] text-sk-mute hover:bg-sk-soft hover:text-sk-text"
            aria-label="閉じる"
          >
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-sk-line px-7 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/** Slack の緑のボタン */
export function PrimaryButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`h-9 rounded-[4px] bg-sk-green px-4 text-[15px] font-bold text-white hover:bg-sk-greenhover disabled:cursor-default disabled:bg-[#DDDDDD] disabled:text-[#1D1C1D80] ${className}`}
    >
      {children}
    </button>
  );
}

/** Slack の白いボタン */
export function SecondaryButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`h-9 rounded-[4px] border border-[#1D1C1D4D] bg-white px-4 text-[15px] font-bold text-sk-text hover:bg-sk-soft hover:shadow-[0_1px_3px_rgba(0,0,0,0.08)] disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

/** Slack の入力欄 */
export const inputClass =
  "w-full h-10 rounded-[4px] border border-[#1D1C1D4D] bg-white px-3 text-[15px] text-sk-text outline-none placeholder:text-[#1D1C1D80] focus:border-[#1D9BD1] focus:shadow-[0_0_0_1px_#1D9BD1,0_0_0_5px_rgba(29,155,209,0.3)]";
