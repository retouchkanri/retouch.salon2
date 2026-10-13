import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANNEL_GROUPS, channelGroupOf } from "../src/lib/community/constants";

test("the admin list has the four groups in the customer's order, then the rest", () => {
  assert.deepEqual(
    CHANNEL_GROUPS.map((g) => [g.key, g.label]),
    [
      ["public", "公開チャンネル"],
      ["member", "会員チャンネル"],
      ["staff", "運営チャンネル"],
      ["horse", "支援馬のチャンネル"],
      ["other", "その他のチャンネル"],
    ],
  );
});

test("each channel falls into one group by its category and audience", () => {
  const ch = (category: string, audience: string, visibility: "public" | "private" = "public") => ({ category, audience, visibility });
  // 公開チャンネル: 全会員に表示するもの（みんなの広場・自己紹介・質問・相談・写真・動画・お知らせ・ご意見箱）
  assert.equal(channelGroupOf(ch("general", "all")), "public");
  assert.equal(channelGroupOf(ch("announcement", "all")), "public");
  // 会員チャンネル: 会員種別ごと。「非公開」に切り替えてあっても会員チャンネルのまま
  assert.equal(channelGroupOf(ch("rank", "plans")), "member");
  assert.equal(channelGroupOf(ch("rank", "plans", "private")), "member");
  // 有料会員だけの広場のように、対象者が会員種別のものも会員チャンネル
  assert.equal(channelGroupOf(ch("general", "plans")), "member");
  // 運営チャンネル
  assert.equal(channelGroupOf(ch("staff", "staff", "private")), "staff");
  assert.equal(channelGroupOf(ch("general", "staff")), "staff");
  // 支援馬のチャンネル
  assert.equal(channelGroupOf(ch("supporters", "supporters")), "horse");
  // 「一般」「お知らせ」のチャンネルは、非公開に切り替えても公開チャンネルのグループのまま（質問・相談など）
  assert.equal(channelGroupOf(ch("general", "all", "private")), "public");
  assert.equal(channelGroupOf(ch("announcement", "all", "private")), "public");
  // それ以外の分類の公開チャンネルも公開チャンネル。招待制（運営が追加した人だけ）のものは「その他」
  assert.equal(channelGroupOf(ch("event", "all")), "public");
  assert.equal(channelGroupOf(ch("event", "all", "private")), "other");
  assert.equal(channelGroupOf(ch("other", "all", "private")), "other");
});
