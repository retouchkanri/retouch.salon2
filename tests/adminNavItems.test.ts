import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { emojiCode, emojiSrc, navGroups } from "../src/app/admin/(protected)/navItems";

test("emojiCode drops the FE0F variation selector", () => {
  assert.equal(emojiCode("📊"), "1f4ca");
  assert.equal(emojiCode("🗓️"), "1f5d3");
  assert.equal(emojiSrc("🛡️"), "/noprecache/emoji/1f6e1.png");
});

test("every admin menu emoji has a self-hosted image", () => {
  const missing = navGroups
    .flatMap((g) => g.items)
    .filter((n) => !existsSync(path.join(process.cwd(), "public", emojiSrc(n.emoji))))
    .map((n) => `${n.label} ${n.emoji} → public${emojiSrc(n.emoji)}`);
  assert.deepEqual(missing, []);
});

test("admin menu hrefs and group ids are unique", () => {
  const hrefs = navGroups.flatMap((g) => g.items.map((n) => n.href));
  assert.equal(new Set(hrefs).size, hrefs.length);
  const ids = navGroups.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
});
