"use client";

import { useState } from "react";

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<null | "ok" | "error">(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, phone, subject, message, company }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setErrorMsg(j.error ?? "送信に失敗しました。");
        return;
      }
      setStatus("ok");
      setName("");
      setEmail("");
      setPhone("");
      setSubject("");
      setMessage("");
    } catch {
      setStatus("error");
      setErrorMsg("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  if (status === "ok") {
    return (
      <div className="text-center py-6">
        <p className="text-brand-dark font-bold mb-2">送信しました。</p>
        <p className="text-ink-soft text-sm">
          お問い合わせありがとうございます。担当者より追ってご連絡いたします。
        </p>
        <button
          type="button"
          onClick={() => setStatus(null)}
          className="mt-4 text-brand underline text-sm"
        >
          続けてお問い合わせする
        </button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="label" htmlFor="contact-name">お名前</label>
          <input
            id="contact-name"
            type="text"
            required
            maxLength={120}
            className="input"
            placeholder="山田 太郎"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="contact-email">メールアドレス</label>
          <input
            id="contact-email"
            type="email"
            required
            className="input"
            placeholder="email@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="contact-phone">
          電話番号 <span className="text-ink-mute font-normal text-xs">（任意）</span>
        </label>
        <input
          id="contact-phone"
          type="tel"
          maxLength={20}
          className="input"
          placeholder="090-0000-0000"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="contact-subject">件名</label>
        <input
          id="contact-subject"
          type="text"
          maxLength={200}
          className="input"
          placeholder="お問い合わせ内容の件名"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="contact-message">メッセージ</label>
        <textarea
          id="contact-message"
          required
          maxLength={5000}
          className="input min-h-[120px] resize-y"
          placeholder="お問い合わせ内容をご記入ください"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </div>

      {/* Honeypot — visually hidden, ignored by humans. */}
      <div aria-hidden className="hidden">
        <label>
          会社名
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
      </div>

      {status === "error" && errorMsg && (
        <p className="text-danger text-sm">{errorMsg}</p>
      )}

      <div className="text-right">
        <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto btn-pulse disabled:opacity-60">
          {busy ? "送信中..." : "送信する"}
        </button>
      </div>
    </form>
  );
}
