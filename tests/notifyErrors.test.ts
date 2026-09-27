import { test } from "node:test";
import assert from "node:assert/strict";
import { isInfrastructureSendError } from "../src/lib/memberMessages";

// 実際に本番で観測したエラー文字列（2026-08-09 の配信障害）。
// Xserver の国外IPアクセス制限が Vercel(AWS us-east-1) の送信元IPを拒否した。
const XSERVER_CLIENT_HOST_REJECTED =
  "EENVELOPE: Can't send mail - all recipients were rejected: 554 5.7.1 " +
  "<ec2-52-205-230-6.compute-1.amazonaws.com[52.205.230.6]>: Client host rejected: Access denied";

test("送信元ホストの拒否は基盤エラー（pending に戻して中断する）", () => {
  // これを failed 扱いにすると、設定を直すまで全会員を1通ずつ焼き払ってしまう。
  assert.equal(isInfrastructureSendError(XSERVER_CLIENT_HOST_REJECTED), true);
  assert.equal(isInfrastructureSendError("554 5.7.1 Relay access denied"), true);
  assert.equal(
    isInfrastructureSendError("550 5.7.1 Sender address rejected: not owned by user"),
    true,
  );
  assert.equal(
    isInfrastructureSendError("554 5.7.1 Client host blocked using zen.spamhaus.org"),
    true,
  );
});

test("認証・レート制限・接続障害は従来どおり基盤エラー", () => {
  assert.equal(isInfrastructureSendError("454-4.7.0 Too many login attempts"), true);
  assert.equal(isInfrastructureSendError("550 5.4.5 Daily user sending limit exceeded"), true);
  assert.equal(isInfrastructureSendError("ESOCKET: Unexpected socket close"), true);
  assert.equal(isInfrastructureSendError("ETIMEDOUT: connection timed out"), true);
  assert.equal(isInfrastructureSendError("smtp not configured"), true);
});

test("宛先固有の失敗は failed のまま（毒薬行にしない）", () => {
  // 同じ 554/5.7.1 でも「受信者が拒否された」ものは基盤エラーにしてはならない。
  assert.equal(
    isInfrastructureSendError("554 5.7.1 <a@b.jp>: Recipient address rejected: Access denied"),
    false,
  );
  assert.equal(isInfrastructureSendError("550 5.1.1 User unknown"), false);
  assert.equal(isInfrastructureSendError("552 5.2.2 Mailbox full"), false);
  assert.equal(isInfrastructureSendError("550 over quota"), false);
  assert.equal(isInfrastructureSendError("450 4.2.1 address not found"), false);
});

test("空・null は基盤エラーではない", () => {
  assert.equal(isInfrastructureSendError(null), false);
  assert.equal(isInfrastructureSendError(undefined), false);
  assert.equal(isInfrastructureSendError(""), false);
});
