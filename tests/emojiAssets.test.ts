import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { EMOJI_GROUPS, QUICK_REACTIONS } from "../src/lib/community/constants";
import { EMOJI_IMAGE_CODES, emojiCode, emojiSrc, hasEmojiImage, isJumboEmoji, splitEmoji } from "../src/lib/emoji";

test("every listed emoji image exists", () => {
  const missing = EMOJI_IMAGE_CODES.filter(
    (c) => !existsSync(path.join(process.cwd(), "public", "noprecache", "emoji", `${c}.png`)),
  );
  assert.deepEqual(missing, []);
});

test("picker and quick reactions all have images", () => {
  const all = [...QUICK_REACTIONS, ...EMOJI_GROUPS.flatMap((g) => g.emojis)];
  assert.deepEqual(all.filter((e) => !hasEmojiImage(e)), []);
});

test("emoji codes and sources", () => {
  assert.equal(emojiCode("❤️"), "2764");
  assert.equal(emojiCode("🙆‍♀️"), "1f646-200d-2640");
  assert.equal(emojiSrc("👍"), "/noprecache/emoji/1f44d.png");
});

test("splitEmoji keeps sequences together", () => {
  assert.deepEqual(splitEmoji("やった🎉👍🏻です"), [
    { type: "text", text: "やった" },
    { type: "emoji", text: "🎉" },
    { type: "emoji", text: "👍🏻" },
    { type: "text", text: "です" },
  ]);
  assert.deepEqual(splitEmoji("🙆‍♀️"), [{ type: "emoji", text: "🙆‍♀️" }]);
  assert.deepEqual(splitEmoji("🇯🇵"), [{ type: "emoji", text: "🇯🇵" }]);
  assert.deepEqual(splitEmoji("text only"), [{ type: "text", text: "text only" }]);
});

test("jumbo emoji only for emoji-only messages", () => {
  assert.equal(isJumboEmoji("🎉🎉"), true);
  assert.equal(isJumboEmoji(" 🐴 "), true);
  assert.equal(isJumboEmoji("🎉 ok"), false);
  assert.equal(isJumboEmoji(""), false);
  assert.equal(isJumboEmoji("🎉".repeat(24)), false);
});
