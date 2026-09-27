"use client";

import { useState } from "react";

function EnvelopeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M3 7l9 6 9-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path
        d="M8 11V8a4 4 0 018 0v3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

type PasswordInputProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
  placeholder?: string;
  className?: string;
  showLockIcon?: boolean;
};

export default function PasswordInput({
  id,
  name,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
  placeholder,
  className = "input",
  showLockIcon = false,
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const padLeft = showLockIcon ? "pl-11" : "";
  const padRight = "pr-12";

  return (
    <div className="relative">
      {showLockIcon && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute">
          <LockIcon />
        </span>
      )}
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        placeholder={placeholder}
        className={`${className} ${padLeft} ${padRight}`}
        value={value}
        onChange={onChange}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-ink-mute hover:text-ink transition-colors"
        aria-label={visible ? "パスワードを隠す" : "パスワードを表示する"}
      >
        {visible ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M3 3l18 18M10.58 10.58A2 2 0 0012 14a2 2 0 001.42-.58M9.88 5.09A10.94 10.94 0 0112 5c5.52 0 10 4.48 10 7s-1.02 2.87-2.62 4.38M6.1 6.1C4.27 7.45 3 9.15 3 12s4.48 7 9 7c1.13 0 2.21-.2 3.2-.56"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M2 12s4.48-7 10-7 10 7 10 7-4.48 7-10 7S2 12 2 12z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
          </svg>
        )}
      </button>
    </div>
  );
}

type EmailInputProps = {
  id?: string;
  name?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
};

export function EmailInput({
  id,
  name,
  value,
  onChange,
  autoComplete,
  required,
  placeholder,
  className = "input",
}: EmailInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-mute">
        <EnvelopeIcon />
      </span>
      <input
        id={id}
        name={name}
        type="email"
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        className={`${className} pl-11`}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
