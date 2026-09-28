"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "./icons";

/** ダイアログ（スマホは下から全幅）。Esc・背景クリックで閉じる。 */
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
      className="rc-anim-backdrop fixed inset-0 z-[160] flex items-end md:items-center justify-center bg-[rgba(22,48,36,0.45)] p-0 backdrop-blur-[3px] md:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        className={`w-full ${wide ? "md:max-w-[640px]" : "md:max-w-[520px]"} max-h-[92dvh] md:max-h-[85dvh] rc-anim-pop flex flex-col bg-white text-sk-text shadow-[0_24px_60px_rgba(22,48,36,0.28)] rounded-t-[24px] md:rounded-[24px] overflow-hidden`}
      >
        <div className="flex items-start justify-between gap-3 px-7 pt-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-[20px] font-bold leading-tight truncate">{title}</h2>
            {subtitle && <div className="mt-1 text-[13px] text-sk-mute">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-3 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sk-mute transition-all duration-200 hover:rotate-90 hover:bg-sk-soft hover:text-sk-text"
            aria-label="閉じる"
          >
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>
        <div className={`flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-sk-line bg-[#F8FAF8] px-7 py-4">{footer}</div>}
      </div>
    </div>
  );
}

/** 主ボタン（緑） */
export function PrimaryButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`h-10 rounded-full bg-sk-green px-5 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(45,106,79,0.22)] transition-all hover:-translate-y-0.5 hover:bg-sk-greenhover disabled:shadow-none disabled:translate-y-0 disabled:cursor-default disabled:bg-[#DCE4DE] disabled:text-[#1E2B2480] ${className}`}
    >
      {children}
    </button>
  );
}

/** 副ボタン（白） */
export function SecondaryButton({
  children,
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`h-10 rounded-full border border-[#DCE4DE] bg-white px-5 text-[14px] font-bold text-sk-text transition-colors hover:border-[#C7D8CD] hover:bg-sk-soft disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

/** 入力欄 */
export const inputClass =
  "w-full h-11 rounded-[14px] border border-[#DCE4DE] bg-[#FBFCFB] px-4 text-[15px] text-sk-text outline-none transition-all placeholder:text-[#8A968F] focus:border-[#2D6A4F] focus:bg-white focus:shadow-[0_0_0_4px_rgba(45,106,79,0.12)]";
