import assert from "node:assert/strict";
import test from "node:test";
import { fallbackChatReply, isGreetingOnly, withCurrentContactEmail } from "../src/lib/chatFallback";

test("a greeting gets a welcome and a short explanation", () => {
  const reply = fallbackChatReply("こんにちは");
  assert.match(reply, /こんにちは/);
  assert.match(reply, /引退した競走馬/);
  assert.equal(reply.includes("support@"), false);
});

test("a greeting with punctuation is still only a greeting", () => {
  assert.equal(isGreetingOnly("こんにちは！"), true);
  assert.equal(isGreetingOnly("こんにちは。会員登録はできますか"), false);
});

test("contact replies use the current address", () => {
  const reply = fallbackChatReply("メールで問い合わせたいです");
  assert.match(reply, /info@retouch\.salon/);
  assert.equal(withCurrentContactEmail("詳細は support@retouch-members.com まで"), "詳細は info@retouch.salon まで");
});
