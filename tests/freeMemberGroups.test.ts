import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_GROUP_AUDIENCES,
  classifyFreeMembers,
  countFreeGroups,
  isFreeGroupAudience,
  monthsAgo,
  type DonationMark,
  type FreeMemberRow,
  type PaymentMark,
} from "../src/lib/freeMemberGroups";
import { AUDIENCE_VALUES, freeGroupAudienceError, legacyAudience } from "../src/lib/memberMessages";

const NOW = new Date("2026-10-08T03:00:00.000Z");

function member(id: string, joined: string, email: string | null = `${id}@x.jp`): FreeMemberRow {
  return { id, email, joined_at: joined, created_at: joined };
}
function donation(partial: Partial<DonationMark>): DonationMark {
  return { customer_id: null, donor_email: null, status: "succeeded", payment_method: "card", ...partial };
}
function payment(customerId: string, kind: string, status = "succeeded"): PaymentMark {
  return { customer_id: customerId, kind, status };
}

test("two months ago follows the Japanese calendar and clamps the end of the month", () => {
  assert.equal(monthsAgo(new Date("2026-10-08T03:00:00.000Z"), 2).toISOString(), "2026-08-08T03:00:00.000Z");
  // 12/31 の 2 か月前は 10/31
  assert.equal(monthsAgo(new Date("2026-12-31T03:00:00.000Z"), 2).toISOString(), "2026-10-31T03:00:00.000Z");
  // 4/30 の 2 か月前は 2 月の末日
  assert.equal(monthsAgo(new Date("2027-04-30T03:00:00.000Z"), 2).toISOString(), "2027-02-28T03:00:00.000Z");
  // 年をまたぐ
  assert.equal(monthsAgo(new Date("2027-01-15T03:00:00.000Z"), 2).toISOString(), "2026-11-15T03:00:00.000Z");
  // 日本時間では 10/1 の朝（UTC では 9/30）。2 か月前は日本時間の 8/1
  assert.equal(monthsAgo(new Date("2026-09-30T16:00:00.000Z"), 2).toISOString(), "2026-07-31T16:00:00.000Z");
});

test("a free member with a donation is in group 1, however it was recorded", () => {
  const members = ["card", "bank", "declared", "guest", "stripe", "old"].map((id) => member(id, "2026-05-01T00:00:00.000Z"));
  const groups = classifyFreeMembers(
    members,
    [
      donation({ customer_id: "card" }),
      donation({ customer_id: "bank", payment_method: "bank_transfer" }),
      // 銀行振込の申告（着金確認待ち）も寄付として数える。
      donation({ customer_id: "declared", payment_method: "bank_transfer", status: "pending" }),
      // 会員に紐づいていない寄付は、メールアドレスで照合する（大文字小文字・前後の空白は無視）。
      donation({ donor_email: " Guest@X.jp " }),
    ],
    [payment("stripe", "donation"), payment("old", "one_time")],
    NOW,
  );
  for (const m of members) assert.equal(groups.get(m.id), "donor", m.id);
});

test("group 2 is only free members with no donation, no past payments, and two months since registering", () => {
  const groups = classifyFreeMembers(
    [
      member("idle", "2026-06-10T00:00:00.000Z"),
      member("boundary", "2026-08-08T03:00:00.000Z"),
      member("recent", "2026-08-08T03:00:01.000Z"),
      member("new", "2026-10-01T00:00:00.000Z"),
      member("unfinished", "2026-06-10T00:00:00.000Z"),
      member("failed", "2026-06-10T00:00:00.000Z"),
      member("former", "2026-06-10T00:00:00.000Z"),
      member("formerDonor", "2026-06-10T00:00:00.000Z"),
    ],
    [
      // カードで手続きを始めただけ（未決済）は寄付に数えない。
      donation({ customer_id: "unfinished", status: "pending", payment_method: "card" }),
      donation({ customer_id: "failed", status: "failed" }),
      donation({ customer_id: "formerDonor" }),
      // 無料会員ではない人の寄付は関係しない。
      donation({ customer_id: "someone-else" }),
    ],
    [payment("failed", "donation", "failed"), payment("former", "subscription"), payment("formerDonor", "subscription")],
    NOW,
  );
  assert.equal(groups.get("idle"), "idle");
  assert.equal(groups.get("boundary"), "idle");
  assert.equal(groups.get("recent"), "recent");
  assert.equal(groups.get("new"), "recent");
  assert.equal(groups.get("unfinished"), "idle");
  assert.equal(groups.get("failed"), "idle");
  // 以前に会費・一口支援を支払っていた人は、寄付がなくても②には入れない。
  assert.equal(groups.get("former"), "former");
  // 寄付があれば①。
  assert.equal(groups.get("formerDonor"), "donor");
  assert.equal(groups.has("someone-else"), false);
  assert.deepEqual(countFreeGroups(groups), { donor: 1, idle: 4, recent: 2, former: 1 });
});

test("a member whose registration date cannot be read is not put in group 2", () => {
  const broken: FreeMemberRow = { id: "x", email: null, joined_at: "not a date", created_at: "not a date" };
  const fallback: FreeMemberRow = { id: "y", email: null, joined_at: null, created_at: "2026-05-01T00:00:00.000Z" };
  const groups = classifyFreeMembers([broken, fallback], [], [], NOW);
  assert.equal(groups.get("x"), "recent");
  // joined_at が無ければ created_at を使う。
  assert.equal(groups.get("y"), "idle");
});

test("the two groups are audience values, stored under the parent value in the legacy column", () => {
  assert.equal(isFreeGroupAudience("no_class_donor"), true);
  assert.equal(isFreeGroupAudience("no_class_idle"), true);
  assert.equal(isFreeGroupAudience("no_class"), false);
  assert.equal(isFreeGroupAudience("toString"), false);
  assert.equal(isFreeGroupAudience(null), false);
  for (const value of Object.keys(FREE_GROUP_AUDIENCES)) assert.ok((AUDIENCE_VALUES as readonly string[]).includes(value), value);
  // 旧・単一値の列は DB の制約があるので、制約にある値だけを入れる。
  assert.equal(legacyAudience(["no_class_idle"]), "no_class");
  assert.equal(legacyAudience(["no_class_donor", "class_a"]), "no_class");
  assert.equal(legacyAudience(["class_a", "no_class_idle"]), "class_a");
  assert.equal(legacyAudience(["all"]), "all");
});

test("the two groups can only be saved by the production build", () => {
  const env = process.env as Record<string, string | undefined>;
  const before = env.NODE_ENV;
  try {
    env.NODE_ENV = "development";
    assert.match(freeGroupAudienceError(["no_class_idle"]) ?? "", /本番サイトでのみ/);
    assert.equal(freeGroupAudienceError(["no_class", "class_a"]), null);
    env.NODE_ENV = "production";
    assert.equal(freeGroupAudienceError(["no_class_idle", "no_class_donor"]), null);
  } finally {
    env.NODE_ENV = before;
  }
});
