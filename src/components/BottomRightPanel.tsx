"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import doImage from "@/assets/images/do.png";
import { ADMIN_AVATAR_URL } from "@/lib/avatarUrls";
import CommunityNavLink from "@/components/community/CommunityNavLink";
import { fallbackChatReply, withCurrentContactEmail } from "@/lib/chatFallback";
import { readTranscript, type SpeechResult, VOICE_SILENCE_MS, watchVoiceSilence } from "@/lib/voiceCapture";

type Message = { from: "bot" | "user"; text: string };

function ChatAvatar({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={`w-6 h-6 rounded-full object-cover flex-shrink-0 border border-surface-line bg-white ${className}`}
    />
  );
}

const INITIAL_MESSAGES: Message[] = [
  { from: "bot", text: "こんにちは！Retouchサポートです。引退競走馬支援についてお気軽にご質問ください。" },
];

const CHATBOT_IMAGE = "/avatars/chatbot.png";

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<SpeechResult> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function speechRecognition(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const host = window as Window & { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return host.SpeechRecognition ?? host.webkitSpeechRecognition ?? null;
}

function speakWithBrowser(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ja-JP";
  utterance.rate = 0.82;
  utterance.pitch = 1.05;
  const voices = window.speechSynthesis.getVoices();
  const voice = voices.find((item) => /ja[-_]JP/i.test(item.lang) && /nanami|ayumi|haruka|sayaka|ichigo/i.test(item.name))
    ?? voices.find((item) => /ja[-_]JP/i.test(item.lang) && !/ichiro|keita/i.test(item.name));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export default function BottomRightPanel({
  showDonate = true,
  showChat = true,
}: {
  /** 単発寄付ボタン（左下）を表示するか。 */
  showDonate?: boolean;
  /** チャットサポートボタンを表示するか。 */
  showChat?: boolean;
} = {}) {
  const [chatOpen, setChatOpen] = useState(false);
  const [donateVisible, setDonateVisible] = useState(true);
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [memberAvatarUrl, setMemberAvatarUrl] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [liveSpeech, setLiveSpeech] = useState<{ committed: string; pending: string } | null>(null);
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);
  const chatOpenRef = useRef(false);
  const transcriptRef = useRef("");
  const cancelVoiceRef = useRef(false);
  const silenceWatchRef = useRef<(() => void) | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const fallbackSilenceRef = useRef<number | null>(null);

  /** ログイン中は会員アバター、未ログインは管理者アバター。 */
  const participantAvatarUrl = loggedIn
    ? (memberAvatarUrl ?? ADMIN_AVATAR_URL)
    : ADMIN_AVATAR_URL;
  const supportAvatarUrl = ADMIN_AVATAR_URL;

  useEffect(() => {
    fetch("/api/chat/avatar")
      .then((res) => res.json())
      .then((data: { loggedIn?: boolean; avatarUrl?: string }) => {
        setLoggedIn(!!data.loggedIn);
        setMemberAvatarUrl(data.avatarUrl ?? ADMIN_AVATAR_URL);
      })
      .catch(() => {
        setLoggedIn(false);
        setMemberAvatarUrl(null);
      });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping, liveSpeech]);

  useEffect(() => {
    chatOpenRef.current = chatOpen;
    if (!chatOpen) {
      stopSpeaking();
      cancelVoiceInput();
      return;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setChatOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [chatOpen]);

  function stopSpeaking() {
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }

  async function speakReply(text: string) {
    if (!chatOpenRef.current) return;
    stopSpeaking();
    try {
      const res = await fetch("/api/chat/speech", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!chatOpenRef.current) return;
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        return;
      }
    } catch {
      // ブラウザの日本語音声へ
    }
    if (chatOpenRef.current) speakWithBrowser(text);
  }

  // AIチャットAPI（/api/chat）に問い合わせ、未設定・エラー時は簡易応答にフォールバック。
  async function fetchBotReply(text: string, history: Message[]): Promise<string> {
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: text,
          history: history
            .slice(-8)
            .map((m) => ({ role: m.from === "user" ? "user" : "assistant", content: m.text })),
        }),
      });
      if (res.ok) {
        const j = await res.json();
        if (j?.ok && typeof j.answer === "string" && j.answer.trim()) return withCurrentContactEmail(j.answer);
      }
    } catch {
      // ネットワークエラー等はフォールバックへ
    }
    return fallbackChatReply(text);
  }

  function respond(raw: string) {
    const text = raw.trim();
    if (!text) return;
    const history = messages;
    setMessages((prev) => [...prev, { from: "user", text }]);
    setInput("");
    setIsTyping(true);
    fetchBotReply(text, history).then((reply) => {
      setIsTyping(false);
      setMessages((prev) => [...prev, { from: "bot", text: reply }]);
      void speakReply(reply);
    });
  }

  function releaseSilenceWatch() {
    silenceWatchRef.current?.();
    silenceWatchRef.current = null;
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
    if (fallbackSilenceRef.current != null) {
      window.clearTimeout(fallbackSilenceRef.current);
      fallbackSilenceRef.current = null;
    }
  }

  function cancelVoiceInput() {
    cancelVoiceRef.current = true;
    transcriptRef.current = "";
    setLiveSpeech(null);
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    try {
      recognition?.abort();
    } catch {
      // すでに止まっている場合はそのまま閉じる
    }
    releaseSilenceWatch();
    setListening(false);
  }

  function armFallbackSilence() {
    if (fallbackSilenceRef.current != null) window.clearTimeout(fallbackSilenceRef.current);
    fallbackSilenceRef.current = window.setTimeout(() => {
      fallbackSilenceRef.current = null;
      const recognition = recognitionRef.current;
      try {
        recognition?.stop();
      } catch {
        recognition?.abort();
      }
    }, VOICE_SILENCE_MS);
  }

  async function toggleVoice() {
    if (listening) {
      cancelVoiceInput();
      return;
    }
    const Ctor = speechRecognition();
    if (!Ctor) {
      setVoiceNote("このブラウザでは音声入力が使えません。");
      return;
    }
    stopSpeaking();
    const recognition = new Ctor();
    recognition.lang = "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = true;
    let delivered = false;
    recognition.onresult = (event) => {
      const heard = readTranscript(event.results);
      transcriptRef.current = heard.text;
      setLiveSpeech(heard.text ? { committed: heard.committed, pending: heard.pending } : null);
      if (!silenceWatchRef.current) armFallbackSilence();
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      cancelVoiceRef.current = true;
      setVoiceNote("音声を聞き取れませんでした。もう一度話してください。");
      try {
        recognition.stop();
      } catch {
        recognition.abort();
      }
    };
    recognition.onend = () => {
      releaseSilenceWatch();
      recognitionRef.current = null;
      setListening(false);
      if (cancelVoiceRef.current) {
        cancelVoiceRef.current = false;
        transcriptRef.current = "";
        setLiveSpeech(null);
        return;
      }
      if (delivered) return;
      delivered = true;
      const transcript = transcriptRef.current.trim();
      transcriptRef.current = "";
      setLiveSpeech(null);
      if (transcript) respond(transcript);
      else setVoiceNote("音声を聞き取れませんでした。もう一度話してください。");
    };
    recognitionRef.current = recognition;
    transcriptRef.current = "";
    cancelVoiceRef.current = false;
    setVoiceNote(null);
    setListening(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (cancelVoiceRef.current || recognitionRef.current !== recognition) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      micStreamRef.current = stream;
      silenceWatchRef.current = watchVoiceSilence(stream, () => {
        try {
          recognition.stop();
        } catch {
          recognition.abort();
        }
      });
    } catch {
      armFallbackSilence();
    }
    try {
      recognition.start();
    } catch {
      releaseSilenceWatch();
      recognitionRef.current = null;
      setListening(false);
      setVoiceNote("マイクを開始できませんでした。");
    }
  }

  function sendMessage() {
    respond(input);
  }

  return (
    <>
      {/* ── 単発寄付（左下の画像ボタン do.png） ── */}
      {showDonate && donateVisible && (
        <div className="fixed bottom-0 left-0 z-40 w-[min(7.5rem,28vw)] max-md:bottom-[4.75rem] sm:w-44 md:w-[22.5rem] md:max-w-[min(22.5rem,40vw)]">
          {/* 閉じる（×）ボタン */}
          <button
            type="button"
            onClick={() => setDonateVisible(false)}
            className="absolute top-1.5 right-1.5 z-50 w-6 h-6 rounded-full bg-white/95 border border-surface-line text-ink-mute hover:text-ink hover:bg-white flex items-center justify-center shadow-md transition-colors"
            aria-label="閉じる"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
              <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          {/* 寄付リンク（3D ボタン効果） */}
          <a
            href="/donate"
            aria-label="単発寄付をする"
            className={[
              "block overflow-hidden rounded-xl",
              // 枠線
              "border-2 border-brand-dark/30",
              // 3D 立体感：下側に影を付けて「浮いている」ように見せる
              "shadow-[0_6px_0_0_rgba(27,67,50,0.30),0_10px_20px_rgba(0,0,0,0.18)]",
              // ホバー：少し持ち上がりさらに輝く
              "hover:-translate-y-1 hover:shadow-[0_8px_0_0_rgba(27,67,50,0.35),0_14px_24px_rgba(0,0,0,0.22)]",
              // 押下：沈み込む
              "active:translate-y-[3px] active:shadow-[0_2px_0_0_rgba(27,67,50,0.25),0_4px_8px_rgba(0,0,0,0.15)]",
              // トランジション
              "transition-all duration-200 ease-out",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40",
            ].join(" ")}
          >
            <Image
              src={doImage}
              alt="単発寄付をする"
              width={640}
              height={640}
              sizes="(max-width: 640px) 28vw, 360px"
              // 約2MBのPNG。最適化API経由だと環境によって失敗し ImageError になるため、表示専用はそのまま配信する
              unoptimized
              className="w-full h-auto object-contain"
            />
          </a>
        </div>
      )}

      {/* ── Fixed bottom-right stack — lifted above the mobile CTA bar on phones ── */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 max-md:bottom-[5.5rem] max-md:right-2">

        {/* コミュニティ（モバイルのみ・お問い合わせチャットの上） */}
        <CommunityNavLink variant="fab" />

        {/* Chatbot button */}
        {showChat && (
          <div className="relative flex items-center justify-center">
            {/* Ping rings — only when chat is closed */}
            {!chatOpen && (
              <>
                <span className="absolute inline-flex h-full w-full rounded-full bg-brand opacity-40 animate-ping" />
                <span className="absolute inline-flex h-[140%] w-[140%] rounded-full bg-brand opacity-20 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite_0.4s]" />
              </>
            )}
            <button
              onClick={() => setChatOpen((v) => !v)}
              className="relative w-12 h-12 rounded-full bg-brand text-white shadow-lg flex items-center justify-center hover:bg-brand-dark hover:scale-110 active:scale-95 transition-all duration-200"
              aria-label="チャットサポートを開く"
            >
              {chatOpen ? (
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M3 3l12 12M15 3L3 15" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          </div>
        )}

        {/* Top button — hidden while hero is in view (see .scroll-top-btn + body.hero-active) */}
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="scroll-top-btn w-12 h-12 rounded-full bg-brand text-white shadow-lg flex items-center justify-center hover:bg-brand-dark transition-colors"
          aria-label="ページトップへ"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 13V3M3 8l5-5 5 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {/* ── Chat modal（画面中央） ── */}
      {showChat && chatOpen && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-ink/40 p-4 sm:p-6"
          onClick={() => setChatOpen(false)}
        >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Retouchサポート"
          className="flex h-[min(40rem,calc(100dvh-2rem))] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-surface-line bg-white shadow-2xl animate-[scaleIn_200ms_ease]"
          onClick={(event) => event.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-brand px-4 py-3 flex items-center gap-3">
            <ChatAvatar
              src={supportAvatarUrl}
              alt="Retouchサポート"
              className="w-8 h-8 border-white/30"
            />
            <div className="flex-1 min-w-0">
              <p className="text-white font-bold text-sm leading-none">Retouchサポート</p>
              <p className="text-white/70 text-xs mt-0.5">声でも話せるサポート</p>
            </div>
            <button
              onClick={() => setChatOpen(false)}
              className="text-white/70 hover:text-white transition-colors"
              aria-label="閉じる"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={CHATBOT_IMAGE}
            alt="Retouchサポート"
            className="h-40 w-full shrink-0 object-cover object-[center_18%] sm:h-48"
          />

          {/* Messages */}
          <div className="min-h-0 flex-1 overflow-y-auto space-y-3 bg-surface-soft p-4 sm:p-5">
            {messages.map((m, i) => (
              <div key={i} className={`flex items-start ${m.from === "user" ? "justify-end" : "justify-start"}`}>
                {m.from === "bot" && (
                  <ChatAvatar
                    src={supportAvatarUrl}
                    alt="Retouchサポート"
                    className="mr-2 mt-0.5"
                  />
                )}
                <div
                  className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    m.from === "user"
                      ? "bg-brand text-white rounded-br-sm"
                      : "bg-white text-ink shadow-sm rounded-bl-sm border border-surface-line"
                  }`}
                >
                  {m.text}
                </div>
                {m.from === "user" && (
                  <ChatAvatar
                    src={participantAvatarUrl}
                    alt={loggedIn ? "あなた" : "ゲスト"}
                    className="ml-2 mt-0.5"
                  />
                )}
              </div>
            ))}
            {liveSpeech && (liveSpeech.committed || liveSpeech.pending) && (
              <div className="flex items-start justify-end" aria-live="polite">
                <div className="max-w-[75%] px-3 py-2 rounded-2xl rounded-br-sm bg-brand text-sm leading-relaxed text-white">
                  {liveSpeech.committed}
                  {liveSpeech.pending ? <span className="opacity-70">{liveSpeech.pending}</span> : null}
                </div>
                <ChatAvatar
                  src={participantAvatarUrl}
                  alt={loggedIn ? "あなた" : "ゲスト"}
                  className="ml-2 mt-0.5"
                />
              </div>
            )}
            {isTyping && (
              <div className="flex justify-start items-start">
                <ChatAvatar
                  src={supportAvatarUrl}
                  alt="Retouchサポート"
                  className="mr-2 mt-0.5"
                />
                <div className="bg-white text-ink shadow-sm border border-surface-line px-3 py-2 rounded-2xl rounded-bl-sm flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-brand/50 rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-brand/50 rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-brand/50 rounded-full animate-bounce [animation-delay:300ms]" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggested quick replies */}
          <div className="px-3 py-2 flex gap-2 flex-wrap bg-white border-t border-surface-line">
            {["会員登録", "寄付について", "退会方法"].map((q) => (
              <button
                key={q}
                onClick={() => respond(q)}
                className="text-xs px-2 py-1 border border-brand/30 text-brand rounded-full hover:bg-brand/5 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>

          {/* Input */}
          <div className="p-3 flex gap-2 bg-white border-t border-surface-line">
            <button
              type="button"
              onClick={toggleVoice}
              disabled={isTyping}
              aria-pressed={listening}
              aria-label={listening ? "録音中。音声入力を止める" : "日本語で話す"}
              className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${listening ? "bg-rose-600 text-white" : "bg-brand-50 text-brand hover:bg-brand-100"}`}
            >
              {listening ? (
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
                  <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="12" r="3.5" fill="currentColor" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="2" />
                  <path d="M6 11a6 6 0 0012 0M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder="メッセージを入力..."
              className="flex-1 text-sm border border-surface-line rounded-full px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="w-9 h-9 rounded-full bg-brand text-white flex items-center justify-center flex-shrink-0 disabled:opacity-40 hover:bg-brand-dark transition-colors"
              aria-label="送信"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {listening || voiceNote ? (
            <p className="px-4 pb-3 -mt-1 text-[11px] text-ink-soft bg-white">{listening ? "話している内容を表示しています。聞き取りが直ると、その場で書き換わります。" : voiceNote}</p>
          ) : null}
        </div>
        </div>
      )}
    </>
  );
}
