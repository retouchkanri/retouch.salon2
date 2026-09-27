import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeMentionQuery,
  applyFormat,
  attachmentPath,
  channelNameProblem,
  normalizeChannelName,
  badgeCount,
  dayKey,
  decodeMentions,
  effectiveNotify,
  encodeMentions,
  formatDayLabel,
  formatTime,
  isVisibleMessage,
  mergeMessages,
  parseInline,
  parseMessageBody,
  plainText,
  shouldGroup,
  shouldNotify,
  upsertMessage,
} from "../src/lib/community/text";
import type { Message } from "../src/lib/community/types";

const A = "00000000-0000-0000-0000-0000000000a1";
const B = "00000000-0000-0000-0000-0000000000b1";

function msg(over: Partial<Message>): Message {
  return {
    id: "m1",
    channel_id: "c1",
    user_id: A,
    parent_id: null,
    body: "",
    attachments: [],
    mentions: [],
    mention_channel: false,
    reactions: {},
    reply_count: 0,
    last_reply_at: null,
    last_reply_user_id: null,
    reply_user_ids: [],
    is_pinned: false,
    pinned_by: null,
    pinned_at: null,
    edited_at: null,
    deleted_at: null,
    deleted_by: null,
    created_at: "2026-09-26T01:00:00.000Z",
    ...over,
  };
}

test("parseInline: formatting, links, mentions", () => {
  assert.deepEqual(parseInline("こんにちは *太字* と ~取消~ と `code`"), [
    { type: "text", text: "こんにちは " },
    { type: "bold", text: "太字" },
    { type: "text", text: " と " },
    { type: "strike", text: "取消" },
    { type: "text", text: " と " },
    { type: "code", text: "code" },
  ]);
  assert.deepEqual(parseInline(`hi <@${A}> <!channel>`), [
    { type: "text", text: "hi " },
    { type: "mention", userId: A },
    { type: "text", text: " " },
    { type: "channel" },
  ]);
  // trailing punctuation is not part of the link
  assert.deepEqual(parseInline("見て https://example.com/a?b=1。"), [
    { type: "text", text: "見て " },
    { type: "link", href: "https://example.com/a?b=1", text: "https://example.com/a?b=1" },
    { type: "text", text: "。" },
  ]);
  // 2*3*4 is not bold
  assert.deepEqual(parseInline("2*3*4"), [{ type: "text", text: "2*3*4" }]);
  // newlines become <br>
  assert.deepEqual(parseInline("a\nb"), [{ type: "text", text: "a" }, { type: "br" }, { type: "text", text: "b" }]);
  // javascript: URLs are never links
  assert.ok(parseInline("javascript:alert(1)").every((i) => i.type === "text"));
  // HTML stays literal text
  assert.deepEqual(parseInline("<b>x</b>"), [{ type: "text", text: "<b>x</b>" }]);
});

test("parseMessageBody: code blocks and unclosed fences", () => {
  assert.deepEqual(parseMessageBody("前\n```\nconst a = 1;\n```\n後"), [
    { type: "para", inlines: [{ type: "text", text: "前" }] },
    { type: "code", text: "const a = 1;" },
    { type: "para", inlines: [{ type: "text", text: "後" }] },
  ]);
  const unclosed = parseMessageBody("a ``` b");
  assert.equal(unclosed.length, 2);
  assert.ok(unclosed.every((b) => b.type === "para"));
});

test("encode/decode mentions round trip", () => {
  const known = [
    { id: A, name: "あきこ" },
    { id: B, name: "あき" },
  ];
  const enc = encodeMentions("@あきこ さんと @あき さん、@channel", known, true);
  assert.equal(enc.body, `<@${A}> さんと <@${B}> さん、<!channel>`);
  assert.deepEqual(enc.mentions.sort(), [A, B].sort());
  assert.equal(enc.mentionChannel, true);

  const noChannel = encodeMentions("@channel", known, false);
  assert.equal(noChannel.body, "@channel");
  assert.equal(noChannel.mentionChannel, false);

  // unknown @names are left alone; typed tokens are neutralised
  const raw = encodeMentions(`@だれか <@${A}>`, known, false);
  assert.equal(raw.mentions.length, 0);
  assert.ok(!raw.body.includes(`<@${A}>`));
  assert.equal(parseInline(raw.body).some((i) => i.type === "mention"), false);

  const names: Record<string, string> = { [A]: "あきこ", [B]: "あき" };
  const dec = decodeMentions(enc.body, (id) => names[id]);
  assert.equal(dec.text, "@あきこ さんと @あき さん、@channel");
  assert.deepEqual(dec.known.map((k) => k.id).sort(), [A, B].sort());
  assert.equal(decodeMentions(raw.body, (id) => names[id]).text, `@だれか <@${A}>`);
});

test("activeMentionQuery", () => {
  assert.deepEqual(activeMentionQuery("こんにちは @あき", 9), { start: 6, query: "あき" });
  assert.deepEqual(activeMentionQuery("こんにちは @あき", 99), { start: 6, query: "あき" });
  assert.deepEqual(activeMentionQuery("@", 1), { start: 0, query: "" });
  assert.equal(activeMentionQuery("mail@example", 12), null);
  assert.equal(activeMentionQuery("@あき こ", 5), null);
});

test("plainText strips tokens for notifications", () => {
  assert.equal(plainText(`*重要* <@${A}> さん\n\`\`\`x\`\`\``, () => "あきこ"), "*重要* @あきこ さん x");
  assert.equal(plainText("a".repeat(200), () => "", 10).length, 10);
});

test("JST time and day labels", () => {
  assert.equal(formatTime("2026-09-25T15:30:00Z"), "00:30");
  assert.equal(dayKey("2026-09-25T15:30:00Z"), "2026-9-26");
  const now = new Date("2026-09-26T03:00:00Z");
  assert.equal(formatDayLabel("2026-09-25T15:30:00Z", now), "今日");
  assert.equal(formatDayLabel("2026-09-25T14:59:00Z", now), "昨日");
  assert.equal(formatDayLabel("2026-09-20T03:00:00Z", now), "9月20日（日）");
  assert.equal(formatDayLabel("2025-12-01T03:00:00Z", now), "2025年12月1日（月）");
});

test("upsert/merge keep chronological order without duplicates", () => {
  const m1 = msg({ id: "a", created_at: "2026-09-26T01:00:00Z" });
  const m2 = msg({ id: "b", created_at: "2026-09-26T01:01:00Z" });
  const m0 = msg({ id: "c", created_at: "2026-09-26T00:59:00Z" });
  let list = upsertMessage([], m1);
  list = upsertMessage(list, m2);
  list = upsertMessage(list, { ...m2, body: "edited" });
  assert.deepEqual(list.map((m) => m.id), ["a", "b"]);
  assert.equal(list[1].body, "edited");
  list = upsertMessage(list, m0);
  assert.deepEqual(list.map((m) => m.id), ["c", "a", "b"]);
  assert.deepEqual(mergeMessages(list, [m1, msg({ id: "d", created_at: "2026-09-26T00:00:00Z" })]).map((m) => m.id), ["d", "c", "a", "b"]);
});

test("grouping and visibility", () => {
  const a = msg({ id: "a", created_at: "2026-09-26T01:00:00Z" });
  assert.equal(shouldGroup(a, msg({ id: "b", created_at: "2026-09-26T01:04:00Z" })), true);
  assert.equal(shouldGroup(a, msg({ id: "b", created_at: "2026-09-26T01:06:00Z" })), false);
  assert.equal(shouldGroup(a, msg({ id: "b", user_id: B, created_at: "2026-09-26T01:01:00Z" })), false);
  assert.equal(isVisibleMessage(msg({ deleted_at: "x" })), false);
  assert.equal(isVisibleMessage(msg({ deleted_at: "x", reply_count: 2 })), true);
});

test("notification rules match the SQL badge rules", () => {
  const general = { kind: "channel" as const, post_policy: "everyone" as const, notify: null, joined: true, unread_count: 5, mention_count: 1 };
  const announce = { ...general, post_policy: "staff" as const };
  const dm = { ...general, kind: "dm" as const };
  assert.equal(effectiveNotify(general), "mentions");
  assert.equal(effectiveNotify(announce), "all");
  assert.equal(effectiveNotify(dm), "all");
  assert.equal(badgeCount(general), 1);
  assert.equal(badgeCount(announce), 5);
  assert.equal(badgeCount({ ...general, notify: "all" }), 5);
  assert.equal(badgeCount({ ...dm, notify: "none" }), 0);

  const plain = msg({ user_id: B });
  assert.equal(shouldNotify(general, plain, A), false);
  assert.equal(shouldNotify(general, { ...plain, mentions: [A] }, A), true);
  assert.equal(shouldNotify(general, { ...plain, mention_channel: true }, A), true);
  assert.equal(shouldNotify(dm, plain, A), true);
  assert.equal(shouldNotify(dm, { ...plain, user_id: A }, A), false);
  assert.equal(shouldNotify(dm, { ...plain, parent_id: "p" }, A), false);
  assert.equal(shouldNotify({ ...dm, notify: "none" }, plain, A), false);
  assert.equal(shouldNotify({ ...general, joined: false, notify: "all" }, plain, A), false);
});

test("attachment paths are ASCII-only and scoped", () => {
  assert.equal(attachmentPath("ch", "u", "写真.JPG", "abc-123"), "ch/u/abc-123.jpg");
  assert.equal(attachmentPath("ch", "u", "noext", "x/../y"), "ch/u/xy");
  assert.equal(attachmentPath("ch", "u", "a.tar.gz", "id"), "ch/u/id.gz");
});

test("italic needs word edges (snake_case stays text)", () => {
  assert.deepEqual(parseInline("これは _斜体_ です"), [
    { type: "text", text: "これは " },
    { type: "italic", text: "斜体" },
    { type: "text", text: " です" },
  ]);
  assert.deepEqual(parseInline("snake_case_name"), [{ type: "text", text: "snake_case_name" }]);
  // underscores inside URLs belong to the link
  assert.deepEqual(parseInline("https://example.com/a_b_c"), [
    { type: "link", href: "https://example.com/a_b_c", text: "https://example.com/a_b_c" },
  ]);
});

test("parseMessageBody: quotes and lists", () => {
  assert.deepEqual(parseMessageBody("前置き\n> 引用1\n> 引用2\n本文"), [
    { type: "para", inlines: [{ type: "text", text: "前置き" }] },
    { type: "quote", inlines: [{ type: "text", text: "引用1" }, { type: "br" }, { type: "text", text: "引用2" }] },
    { type: "para", inlines: [{ type: "text", text: "本文" }] },
  ]);
  assert.deepEqual(parseMessageBody("• りんご\n- *みかん*\n・ぶどう"), [
    {
      type: "list",
      ordered: false,
      start: 1,
      items: [
        [{ type: "text", text: "りんご" }],
        [{ type: "bold", text: "みかん" }],
        [{ type: "text", text: "ぶどう" }],
      ],
    },
  ]);
  const ordered = parseMessageBody("3. 三\n4. 四");
  assert.equal(ordered.length, 1);
  assert.equal(ordered[0].type, "list");
  if (ordered[0].type === "list") {
    assert.equal(ordered[0].ordered, true);
    assert.equal(ordered[0].start, 3);
    assert.equal(ordered[0].items.length, 2);
  }
  // "-" without a following space is plain text; code blocks are untouched
  assert.deepEqual(parseMessageBody("-1度"), [{ type: "para", inlines: [{ type: "text", text: "-1度" }] }]);
  assert.deepEqual(parseMessageBody("```\n> not a quote\n```"), [{ type: "code", text: "> not a quote" }]);
});

test("channel names follow the SQL rules", () => {
  assert.equal(normalizeChannelName("  #My Cool  Channel "), "my-cool-channel");
  assert.equal(normalizeChannelName("＃　馬好き　集まれ　"), "馬好き-集まれ");
  assert.equal(channelNameProblem("", false), "チャンネル名を入力してください。");
  assert.match(channelNameProblem("a/b", false) ?? "", /記号/);
  assert.match(channelNameProblem("a#b", false) ?? "", /記号/);
  assert.match(channelNameProblem("あ".repeat(61), false) ?? "", /60文字/);
  assert.match(channelNameProblem("運営からの連絡", false) ?? "", /使用できません/);
  assert.equal(channelNameProblem("運営からの連絡", true), null);
  assert.equal(channelNameProblem("馬好き_集まれ-2026", false), null);
});

test("applyFormat wraps selections and prefixes lines", () => {
  assert.deepEqual(applyFormat("abc", 0, 3, "bold"), { text: "*abc*", start: 1, end: 4 });
  assert.deepEqual(applyFormat("", 0, 0, "italic"), { text: "_斜体_", start: 1, end: 3 });
  assert.equal(applyFormat("x", 1, 1, "codeblock").text, "x```\nコード\n```");
  assert.equal(applyFormat("一\n二", 0, 3, "bullet").text, "• 一\n• 二");
  assert.equal(applyFormat("• 一\n• 二", 0, 7, "ordered").text, "1. 一\n2. 二");
  assert.equal(applyFormat("引用", 1, 1, "quote").text, "> 引用");
  assert.equal(applyFormat("見て", 0, 2, "link", "https://e.com").text, "見て https://e.com");
  assert.equal(applyFormat("abc", 0, 3, "link", "  ").text, "abc");
});
