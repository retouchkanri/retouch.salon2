/** 声が途切れてから、一文の終わりとみなすまでの時間。 */
export const VOICE_SILENCE_MS = 2000;

/** これ未満の音量は無音として扱う。 */
export const VOICE_RMS_THRESHOLD = 0.02;

export function rmsFromTimeDomain(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const normalized = (samples[i] - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.sqrt(sum / samples.length);
}

export function nextVoiceMark(lastVoiceAt: number, rms: number, now: number): number {
  return rms >= VOICE_RMS_THRESHOLD ? now : lastVoiceAt;
}

export function silenceShouldEnd(lastVoiceAt: number, now: number, limitMs = VOICE_SILENCE_MS): boolean {
  return now - lastVoiceAt >= limitMs;
}

export type SpeechResult = ArrayLike<{ transcript?: string }> & { isFinal?: boolean };

/** 確定した聞き取りと、まだ直るかもしれない途中の聞き取りを分ける。 */
export function readTranscript(results: ArrayLike<SpeechResult>): {
  committed: string;
  pending: string;
  text: string;
} {
  let committed = "";
  let pending = "";
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const text = result?.[0]?.transcript ?? "";
    if (result?.isFinal) committed += text;
    else pending += text;
  }
  const text = (committed + pending).replace(/\s+/g, " ").trim();
  return {
    committed: committed.replace(/\s+/g, " ").trim(),
    pending: pending.replace(/\s+/g, " ").trim(),
    text,
  };
}

export function joinTranscript(results: ArrayLike<SpeechResult>): string {
  return readTranscript(results).text;
}

/**
 * マイクの音量を見て、声が約2秒なければ onSilence を一度だけ呼ぶ。
 * 戻り値を呼ぶと監視を止める。
 */
export function watchVoiceSilence(stream: MediaStream, onSilence: () => void): () => void {
  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  let lastVoiceAt = performance.now();
  let stopped = false;

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    source.disconnect();
    void audioContext.close();
  };

  const timer = window.setInterval(() => {
    if (stopped) return;
    analyser.getByteTimeDomainData(samples);
    const now = performance.now();
    lastVoiceAt = nextVoiceMark(lastVoiceAt, rmsFromTimeDomain(samples), now);
    if (!silenceShouldEnd(lastVoiceAt, now)) return;
    cleanup();
    onSilence();
  }, 100);

  return cleanup;
}
