import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGivingInsight, isFoundingSupporter, moverCustomerIds, supportStars } from "../src/lib/donationInsight";
import type { ReportSource } from "../src/lib/monthlyReport";

test("support stars grow every six months and stop at five", () => {
  assert.equal(supportStars("2026-08-01T00:00:00.000Z", new Date("2026-10-01T00:00:00.000Z")), 0);
  assert.equal(supportStars("2025-03-01T00:00:00.000Z", new Date("2026-10-01T00:00:00.000Z")), 3);
  assert.equal(supportStars("2020-01-01T00:00:00.000Z", new Date("2026-10-01T00:00:00.000Z")), 5);
});

test("founding supporters are those who started within 60 days of the horse record", () => {
  assert.equal(isFoundingSupporter("2026-02-01T00:00:00.000Z", "2026-01-15T00:00:00.000Z"), true);
  assert.equal(isFoundingSupporter("2026-06-01T00:00:00.000Z", "2026-01-15T00:00:00.000Z"), false);
});

test("income drop is attributed to the slice that fell", () => {
  const source: ReportSource = {
    customers: [],
    horses: [{ id: "ume", name: "梅", created_at: "2020-01-01T00:00:00.000Z" }],
    bookings: [],
    contracts: [
      { id: "dues", customer_id: "a", started_at: "2026-01-01T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "A" },
      { id: "share", customer_id: "b", started_at: "2026-01-01T00:00:00.000Z", canceled_at: null, status: "active", plan_code: "SUPPORT" },
    ],
    supports: [
      { customer_id: "b", horse_id: "ume", units: 2, monthly_amount: 24000, started_at: "2026-08-01T00:00:00.000Z", canceled_at: "2026-10-05T00:00:00.000Z", status: "canceled" },
      { customer_id: "b", horse_id: "ume", units: 1, monthly_amount: 12000, started_at: "2026-10-05T00:00:00.000Z", canceled_at: null, status: "active" },
    ],
    donations: [
      { amount: 50000, status: "succeeded", payment_method: "card", donated_at: "2026-09-10T00:00:00.000Z", confirmed_at: null, payment_intent_id: "pi_sep" },
      { amount: 10000, status: "succeeded", payment_method: "card", donated_at: "2026-10-10T00:00:00.000Z", confirmed_at: null, payment_intent_id: "pi_oct" },
    ],
    payments: [
      { amount: 3000, status: "succeeded", kind: "subscription", occurred_at: "2026-09-10T00:00:00.000Z", contract_id: "dues" },
      { amount: 3000, status: "succeeded", kind: "subscription", occurred_at: "2026-10-10T00:00:00.000Z", contract_id: "dues" },
      { amount: 24000, status: "succeeded", kind: "subscription", occurred_at: "2026-09-10T00:00:00.000Z", contract_id: "share" },
      { amount: 12000, status: "succeeded", kind: "subscription", occurred_at: "2026-10-10T00:00:00.000Z", contract_id: "share" },
      { amount: 1000, status: "failed", kind: "subscription", occurred_at: "2026-10-12T00:00:00.000Z", contract_id: "dues" },
      { amount: 50000, status: "succeeded", kind: "donation", occurred_at: "2026-09-10T00:01:00.000Z", contract_id: null, payment_intent_id: "pi_sep", charge_id: "ch_sep" },
      { amount: 10000, status: "succeeded", kind: "donation", occurred_at: "2026-10-10T00:01:00.000Z", contract_id: null, payment_intent_id: "pi_oct", charge_id: "ch_oct" },
    ],
  };
  const insight = buildGivingInsight(source, "2026-10");
  assert.ok(insight);
  const card = insight.slices.find((slice) => slice.key === "card");
  const share = insight.slices.find((slice) => slice.key === "share");
  assert.equal(card?.delta, -40000);
  assert.equal(share?.delta, -12000);
  assert.equal(insight.incomeDelta, -52000);
  assert.equal(insight.horses[0]?.deltaYen, -12000);
  assert.equal(insight.failedPayments, 1);
  assert.equal(insight.signals.some((signal) => signal.level === "alert" && signal.title.includes("決済エラー")), true);
});

test("bright spot uses money and horses gained up to now, and a past month uses the whole month", () => {
  const source: ReportSource = {
    customers: [],
    horses: [{ id: "hana", name: "花", created_at: "2020-01-01T00:00:00.000Z" }],
    bookings: [],
    contracts: [],
    supports: [
      { customer_id: "a", horse_id: "hana", units: 1, monthly_amount: 12000, started_at: "2026-09-01T00:00:00.000Z", canceled_at: null, status: "active" },
      { customer_id: "b", horse_id: "hana", units: 1, monthly_amount: 12000, started_at: "2026-10-03T00:00:00.000Z", canceled_at: null, status: "active" },
      { customer_id: "c", horse_id: "hana", units: 1, monthly_amount: 12000, started_at: "2026-10-25T00:00:00.000Z", canceled_at: null, status: "active" },
    ],
    donations: [],
    payments: [
      { amount: 5000, status: "succeeded", kind: "subscription", occurred_at: "2026-09-02T00:00:00.000Z", contract_id: null },
      { amount: 8000, status: "succeeded", kind: "subscription", occurred_at: "2026-10-02T00:00:00.000Z", contract_id: null },
      { amount: 9000, status: "succeeded", kind: "subscription", occurred_at: "2026-10-21T00:00:00.000Z", contract_id: null },
      { amount: 1000, status: "failed", kind: "subscription", occurred_at: "2026-10-02T00:00:00.000Z", contract_id: null },
    ],
  };
  const now = new Date("2026-10-20T00:00:00.000Z");
  const october = buildGivingInsight(source, "2026-10", now);
  assert.ok(october);
  assert.equal(october.bright.receivedYen, 8000);
  assert.equal(october.bright.receivedCount, 1);
  assert.equal(october.bright.newSupports, 1);
  assert.equal(october.bright.gained.length, 1);
  assert.equal(october.bright.gained[0]?.deltaUnits, 1);

  const september = buildGivingInsight(source, "2026-09", now);
  assert.ok(september);
  assert.equal(september.bright.receivedYen, 5000);
  assert.equal(september.bright.receivedCount, 1);
  assert.equal(september.bright.newSupports, 1);
  assert.equal(september.bright.gained[0]?.deltaUnits, 1);
});

test("only horses that are open for support are flagged as having no units", () => {
  const source: ReportSource = {
    customers: [],
    bookings: [],
    contracts: [],
    donations: [],
    payments: [],
    horses: [
      { id: "open", name: "60：お名前選定中", created_at: "2026-08-01T00:00:00.000Z", is_supportable: true },
      { id: "sold", name: "08：ピノ（オーナー決定）", created_at: "2026-01-01T00:00:00.000Z", is_supportable: false },
      { id: "team", name: "番外編　目が負傷のポニー救済支援チーム", created_at: "2026-01-01T00:00:00.000Z", is_supportable: false },
      { id: "late", name: "50：（故）アース", created_at: "2026-01-01T00:00:00.000Z", is_supportable: false },
      { id: "backed", name: "01：パヴォーネ", created_at: "2026-01-01T00:00:00.000Z", is_supportable: true },
    ],
    supports: [
      { customer_id: "a", horse_id: "backed", units: 1, monthly_amount: 12000, started_at: "2026-09-01T00:00:00.000Z", canceled_at: null, status: "active" },
    ],
  };
  const insight = buildGivingInsight(source, "2026-10", new Date("2026-10-20T00:00:00.000Z"));
  assert.ok(insight);
  assert.deepEqual(insight.shortHorses.map((horse) => horse.id), ["open"]);
  assert.equal(insight.signals.some((signal) => signal.title === "支援口数が付いていない馬 1頭"), true);
});

test("each increase and decrease of units names the people behind it", () => {
  const source: ReportSource = {
    customers: [],
    bookings: [],
    contracts: [],
    donations: [],
    payments: [],
    horses: [
      { id: "hana", name: "01：花", created_at: "2020-01-01T00:00:00.000Z" },
      { id: "ume", name: "02：梅", created_at: "2020-01-01T00:00:00.000Z" },
    ],
    supports: [
      // 花：a は続けている。b は 10/3 に 1口で始めた。c は 10/4 に 0.5口で始めた。
      { customer_id: "a", horse_id: "hana", units: 1, monthly_amount: 12000, started_at: "2026-08-01T00:00:00.000Z", canceled_at: null, status: "active" },
      { customer_id: "b", horse_id: "hana", units: 1, monthly_amount: 12000, started_at: "2026-10-03T00:00:00.000Z", canceled_at: null, status: "active" },
      { customer_id: "c", horse_id: "hana", units: 0.5, monthly_amount: 6000, started_at: "2026-10-04T00:00:00.000Z", canceled_at: null, status: "active" },
      // 梅：d は 10/6 に 2口を停止した。e は 10/8 に 2口をやめて、同じ日に 1口で登録し直した（1口の減少）。
      { customer_id: "d", horse_id: "ume", units: 2, monthly_amount: 24000, started_at: "2026-07-01T00:00:00.000Z", canceled_at: "2026-10-06T00:00:00.000Z", status: "canceled" },
      { customer_id: "e", horse_id: "ume", units: 2, monthly_amount: 24000, started_at: "2026-07-01T00:00:00.000Z", canceled_at: "2026-10-08T00:00:00.000Z", status: "canceled" },
      { customer_id: "e", horse_id: "ume", units: 1, monthly_amount: 12000, started_at: "2026-10-08T00:00:00.000Z", canceled_at: null, status: "active" },
      // 支払いが済んでいない申込は、増えた人に数えない。
      { customer_id: "f", horse_id: "hana", units: 1, monthly_amount: 12000, started_at: "2026-10-09T00:00:00.000Z", canceled_at: null, status: "incomplete" },
    ],
  };
  const insight = buildGivingInsight(source, "2026-10", new Date("2026-10-20T00:00:00.000Z"));
  assert.ok(insight);

  // 口数が増えた馬の下に、増やした人が口数の大きい順に並ぶ。人ごとの口数を足すと、馬の増えた口数になる。
  assert.equal(insight.bright.gained.length, 1);
  const hana = insight.bright.gained[0];
  assert.equal(hana.deltaUnits, 1.5);
  assert.deepEqual(hana.people.map((mover) => [mover.customerId, mover.deltaUnits]), [["b", 1], ["c", 0.5]]);
  assert.equal(hana.people.reduce((sum, mover) => sum + mover.deltaUnits, 0), hana.deltaUnits);

  // 支援停止の件数と同じ数だけ、人が並ぶ（新しい停止が先）。続けている口数があれば添える。
  assert.equal(insight.stoppedSupports, 2);
  assert.deepEqual(
    insight.stopped.map((mover) => [mover.customerId, mover.horseName, mover.deltaUnits, mover.keptUnits ?? 0]),
    [["e", "02：梅", -2, 1], ["d", "02：梅", -2, 0]],
  );
  const stopSignal = insight.signals.find((signal) => signal.title === "支援停止 2件");
  assert.equal(stopSignal?.peopleMode, "stopped");
  assert.equal(stopSignal?.people?.length, 2);

  // 馬ごとの増減には、差し引きの口数で出る（登録し直した e は 1口の減少）。
  const ume = insight.horses.find((horse) => horse.id === "ume");
  assert.equal(ume?.deltaUnits, -3);
  assert.deepEqual(ume?.people.map((mover) => [mover.customerId, mover.deltaUnits]), [["d", -2], ["e", -1]]);

  assert.deepEqual(moverCustomerIds(insight).sort(), ["b", "c", "d", "e"]);
});
