import { test } from "node:test";
import assert from "node:assert/strict";
import { sendMemberMessageUntilDone, type SendProgress } from "../src/lib/memberMessagesClient";

/**
 * 進捗バーは sendMemberMessageUntilDone の onProgress が正しく発火することに依存する。
 * fetch を差し替えて、バッチごとの進捗が積み上がって報告されるかを検証する。
 */

type Batch = { sentCount: number; remaining: number; recipientCount: number; status?: string; throttled?: boolean; throttleReason?: string };

/** 指定したバッチ列を順に返す fetch スタブを global に差し込む。 */
function stubFetch(batches: Batch[], opts: { httpError?: boolean } = {}) {
  let i = 0;
  (globalThis as any).fetch = async () => {
    if (opts.httpError) {
      return { ok: false, json: async () => ({ error: "配信に失敗しました。" }) } as any;
    }
    const b = batches[Math.min(i, batches.length - 1)];
    i++;
    return { ok: true, json: async () => ({ ok: true, result: { status: "sending", ...b } }) } as any;
  };
  return () => i;
}

test("進捗が1バッチごとに報告され、残0で完了する", async () => {
  const calls = stubFetch([
    { sentCount: 50, remaining: 100, recipientCount: 150 },
    { sentCount: 120, remaining: 30, recipientCount: 150 },
    { sentCount: 150, remaining: 0, recipientCount: 150 },
  ]);

  const seen: SendProgress[] = [];
  const result = await sendMemberMessageUntilDone("msg-1", (p) => seen.push({ ...p }));

  assert.equal(result.ok, true);
  assert.equal(result.finished, true);
  // 3バッチぶんの進捗が順に報告される
  assert.equal(seen.length, 3);
  assert.deepEqual(
    seen.map((p) => p.sentCount),
    [50, 120, 150],
  );
  // 全体件数は毎回同じ値で渡る（バーの分母が途中で揺れない）
  assert.ok(seen.every((p) => p.recipientCount === 150));
  // 進捗は単調増加でなければならない（バーが戻ると誤解を招く）
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i].sentCount >= seen[i - 1].sentCount, "sentCount must not decrease");
  }
  assert.equal(result.progress.sentCount, 150);
  assert.equal(calls(), 3);
});

test("スロットル検知でループを止め、それまでの進捗を返す", async () => {
  stubFetch([
    { sentCount: 40, remaining: 60, recipientCount: 100 },
    { sentCount: 40, remaining: 60, recipientCount: 100, throttled: true, throttleReason: "Client host rejected" },
  ]);

  const seen: SendProgress[] = [];
  const result = await sendMemberMessageUntilDone("msg-2", (p) => seen.push({ ...p }));

  assert.equal(result.ok, true);
  assert.equal(result.finished, false);
  assert.equal(result.throttled, true);
  assert.match(result.throttleReason ?? "", /Client host rejected/);
  // 未送信分は残ったまま（バーは 40/100 で止まる）
  assert.equal(result.progress.sentCount, 40);
  assert.equal(result.progress.remaining, 60);
});

test("HTTPエラー時は ok=false を返し、進捗を捏造しない", async () => {
  stubFetch([], { httpError: true });
  const result = await sendMemberMessageUntilDone("msg-3");
  assert.equal(result.ok, false);
  assert.equal(result.finished, false);
  assert.equal(result.progress.sentCount, 0);
});
