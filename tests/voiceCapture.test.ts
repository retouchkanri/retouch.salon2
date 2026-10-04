import assert from "node:assert/strict";
import test from "node:test";
import {
  joinTranscript,
  nextVoiceMark,
  readTranscript,
  rmsFromTimeDomain,
  silenceShouldEnd,
  type SpeechResult,
  VOICE_SILENCE_MS,
} from "../src/lib/voiceCapture";

test("silence of two seconds ends the utterance", () => {
  assert.equal(silenceShouldEnd(0, VOICE_SILENCE_MS - 1), false);
  assert.equal(silenceShouldEnd(0, VOICE_SILENCE_MS), true);
});

test("voice resets the silence clock", () => {
  const loud = new Uint8Array(8).fill(180);
  const quiet = new Uint8Array(8).fill(128);
  assert.ok(rmsFromTimeDomain(loud) > rmsFromTimeDomain(quiet));
  assert.equal(nextVoiceMark(1000, rmsFromTimeDomain(loud), 2500), 2500);
  assert.equal(nextVoiceMark(1000, rmsFromTimeDomain(quiet), 2500), 1000);
  assert.equal(silenceShouldEnd(2500, 4499), false);
  assert.equal(silenceShouldEnd(2500, 4500), true);
});

function speechResult(transcript: string, isFinal: boolean): SpeechResult {
  const result = [{ transcript }] as SpeechResult;
  result.isFinal = isFinal;
  return result;
}

test("recognition results become one sentence", () => {
  assert.equal(
    joinTranscript([speechResult("会員登録", true), speechResult("について", true)]),
    "会員登録について",
  );
});

test("a wrong interim phrase is replaced by the corrected final text", () => {
  const hearing = readTranscript([speechResult("会いん登録", false)]);
  assert.equal(hearing.pending, "会いん登録");
  assert.equal(hearing.committed, "");

  const corrected = readTranscript([
    speechResult("会員登録", true),
    speechResult("について", false),
  ]);
  assert.equal(corrected.committed, "会員登録");
  assert.equal(corrected.pending, "について");
  assert.equal(corrected.text, "会員登録について");
});
