import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BACKUP_SETTINGS,
  MAX_SCHEDULED_ATTEMPTS,
  backupFileName,
  backupObjectPath,
  decideScheduledRun,
  isLegacyJsonBackup,
  jstCalendarDate,
  latestOccurrence,
  nextOccurrence,
  parseBackupFileName,
  parseBackupSettings,
  parseScheduledState,
  selectExpiredBackups,
  uuidRangeBounds,
  type BackupSettings,
  type ScheduledState,
} from "../src/lib/dbBackupSchedule";

const on = (hourJst: number): BackupSettings => ({ enabled: true, hourJst, retention: 14 });

test("parseBackupSettings: defaults and validation", () => {
  assert.deepEqual(parseBackupSettings({}), DEFAULT_BACKUP_SETTINGS);
  assert.deepEqual(parseBackupSettings({ enabled: "true", hour: "0", retention: "1" }), {
    enabled: true,
    hourJst: 0,
    retention: 1,
  });
  // out of range / garbage → defaults
  const bad = parseBackupSettings({ enabled: "yes", hour: "24", retention: "0" });
  assert.equal(bad.enabled, false);
  assert.equal(bad.hourJst, DEFAULT_BACKUP_SETTINGS.hourJst);
  assert.equal(bad.retention, DEFAULT_BACKUP_SETTINGS.retention);
  assert.equal(parseBackupSettings({ hour: "3.5" }).hourJst, DEFAULT_BACKUP_SETTINGS.hourJst);
  assert.equal(parseBackupSettings({ retention: "91" }).retention, DEFAULT_BACKUP_SETTINGS.retention);
});

test("latestOccurrence / nextOccurrence use JST (UTC+9)", () => {
  // 2026-09-25 18:30 UTC = 2026-09-26 03:30 JST → latest 03:00 JST = 2026-09-25T18:00Z
  const now = new Date("2026-09-25T18:30:00Z");
  assert.equal(latestOccurrence(now, 3).toISOString(), "2026-09-25T18:00:00.000Z");
  assert.equal(nextOccurrence(now, 3).toISOString(), "2026-09-26T18:00:00.000Z");
  // 02:59 JST → the 03:00 of the previous JST day
  const before = new Date("2026-09-25T17:59:00Z");
  assert.equal(latestOccurrence(before, 3).toISOString(), "2026-09-24T18:00:00.000Z");
  // exactly on the hour counts as that occurrence
  assert.equal(latestOccurrence(new Date("2026-09-25T18:00:00Z"), 3).toISOString(), "2026-09-25T18:00:00.000Z");
  // 23:00 JST = 14:00 UTC; midnight JST hour 0 = 15:00 UTC previous day
  assert.equal(latestOccurrence(new Date("2026-09-25T15:10:00Z"), 0).toISOString(), "2026-09-25T15:00:00.000Z");
  assert.equal(latestOccurrence(new Date("2026-09-25T14:30:00Z"), 23).toISOString(), "2026-09-25T14:00:00.000Z");
});

test("decideScheduledRun: disabled / window", () => {
  const now = new Date("2026-09-25T18:40:00Z"); // 03:40 JST
  assert.deepEqual(decideScheduledRun(now, { ...on(3), enabled: false }, null), { run: false, reason: "disabled" });
  assert.deepEqual(decideScheduledRun(now, on(3), null), {
    run: true,
    occurrence: "2026-09-25T18:00:00.000Z",
    attempt: 1,
  });
  // other hour slots of the day do nothing
  assert.deepEqual(decideScheduledRun(now, on(9), null), { run: false, reason: "outside_window" });
  // retry window is 3 hours: 05:59 JST still runs, 06:00 JST does not
  assert.equal(decideScheduledRun(new Date("2026-09-25T20:59:59Z"), on(3), null).run, true);
  assert.deepEqual(decideScheduledRun(new Date("2026-09-25T21:00:00Z"), on(3), null), {
    run: false,
    reason: "outside_window",
  });
  // window crossing JST midnight (23:00 → 01:59)
  assert.equal(decideScheduledRun(new Date("2026-09-25T16:30:00Z"), on(23), null).run, true);
});

test("decideScheduledRun: idempotency, in-progress, retries", () => {
  const occurrence = "2026-09-25T18:00:00.000Z";
  const now = new Date("2026-09-25T19:05:00Z"); // 04:05 JST
  const base: ScheduledState = { occurrence, status: "ok", attempts: 1, started_at: "2026-09-25T18:20:00Z" };

  assert.deepEqual(decideScheduledRun(now, on(3), base), { run: false, reason: "already_done" });

  const running = { ...base, status: "running" as const, started_at: "2026-09-25T19:00:00Z" };
  assert.deepEqual(decideScheduledRun(now, on(3), running), { run: false, reason: "in_progress" });

  // a "running" record older than the stale threshold was killed (timeout) → retry
  const stale = { ...running, started_at: "2026-09-25T18:20:00Z" };
  assert.deepEqual(decideScheduledRun(now, on(3), stale), { run: true, occurrence, attempt: 2 });

  const failed = { ...base, status: "error" as const };
  assert.deepEqual(decideScheduledRun(now, on(3), failed), { run: true, occurrence, attempt: 2 });
  assert.deepEqual(
    decideScheduledRun(now, on(3), { ...failed, attempts: MAX_SCHEDULED_ATTEMPTS }),
    { run: false, reason: "max_attempts" },
  );

  // yesterday's state never blocks today's run
  const yesterday = { ...base, occurrence: "2026-09-24T18:00:00.000Z" };
  assert.deepEqual(decideScheduledRun(now, on(3), yesterday), { run: true, occurrence, attempt: 1 });
});

test("parseScheduledState tolerates bad input", () => {
  assert.equal(parseScheduledState(null), null);
  assert.equal(parseScheduledState("not json"), null);
  assert.equal(parseScheduledState(JSON.stringify({ status: "ok" })), null);
  const s = parseScheduledState(JSON.stringify({ occurrence: "x", status: "ok", started_at: "y" }));
  assert.equal(s?.attempts, 1);
});

test("backup file names: daily scheduled, timestamped manual, reject paths", () => {
  const at = new Date("2026-09-25T18:00:12.345Z"); // 2026-09-26 03:00:12 JST
  assert.equal(jstCalendarDate(at), "2026-09-26");
  assert.equal(backupFileName(at, "scheduled"), "db-backup_2026-09-26_scheduled.tar.gz");
  assert.equal(backupObjectPath("db-backup_2026-09-26_scheduled.tar.gz"), "backups/db-backup_2026-09-26_scheduled.tar.gz");

  const daily = parseBackupFileName("db-backup_2026-09-26_scheduled.tar.gz");
  assert.equal(daily?.trigger, "scheduled");
  assert.equal(daily?.createdAt.toISOString(), new Date("2026-09-26T00:00:00+09:00").toISOString());

  const manualName = backupFileName(at, "manual");
  assert.equal(manualName, "db-backup_2026-09-25T18-00-12-345Z_manual.tar.gz");
  assert.equal(parseBackupFileName(manualName)?.trigger, "manual");
  assert.equal(parseBackupFileName(manualName)?.createdAt.toISOString(), at.toISOString());
  assert.equal(isLegacyJsonBackup(manualName), false);

  // legacy DB-only .json.gz names still parse (daily and pre-daily timestamped naming)
  assert.equal(parseBackupFileName("db-backup_2026-09-26_scheduled.json.gz")?.trigger, "scheduled");
  assert.equal(isLegacyJsonBackup("db-backup_2026-09-26_scheduled.json.gz"), true);
  const legacy = parseBackupFileName("db-backup_2026-09-25T18-00-12-345Z_scheduled.json.gz");
  assert.equal(legacy?.trigger, "scheduled");
  assert.equal(legacy?.createdAt.toISOString(), at.toISOString());

  for (const bad of [
    "../db-backup_2026-09-25T18-00-12-345Z_manual.tar.gz",
    "x/db-backup_2026-09-25T18-00-12-345Z_manual.tar.gz",
    "backups/db-backup_2026-09-26_scheduled.tar.gz",
    "db-backup_2026-09-25T18-00-12-345Z_other.tar.gz",
    "db-backup_2026-09-25T18-00-12-345Z_manual.json",
    "db-backup_2026-09-25T18-00-12-345Z_manual.tar.gz.partial",
    "db-backup_2026-09-26_manual.tar.gz",
    "avatars/foo.png",
    "",
  ]) {
    assert.equal(parseBackupFileName(bad), null, bad);
  }
});

test("selectExpiredBackups keeps the newest N scheduled and never touches manual", () => {
  const names = [
    "db-backup_2026-09-20_scheduled.json.gz",
    "db-backup_2026-09-22_scheduled.tar.gz",
    "db-backup_2026-09-21_scheduled.tar.gz",
    "db-backup_2026-09-01T00-00-00-000Z_manual.tar.gz",
    "unrelated.txt",
  ];
  assert.deepEqual(selectExpiredBackups(names, 2), ["db-backup_2026-09-20_scheduled.json.gz"]);
  assert.deepEqual(selectExpiredBackups(names, 3), []);
  assert.deepEqual(selectExpiredBackups(names, 1), [
    "db-backup_2026-09-21_scheduled.tar.gz",
    "db-backup_2026-09-20_scheduled.json.gz",
  ]);
});

test("uuidRangeBounds covers the whole key space without gaps", () => {
  assert.deepEqual(uuidRangeBounds(1), [[null, null]]);
  const four = uuidRangeBounds(4);
  assert.deepEqual(four, [
    [null, "40000000-0000-0000-0000-000000000000"],
    ["40000000-0000-0000-0000-000000000000", "80000000-0000-0000-0000-000000000000"],
    ["80000000-0000-0000-0000-000000000000", "c0000000-0000-0000-0000-000000000000"],
    ["c0000000-0000-0000-0000-000000000000", null],
  ]);
  // each upper bound is the next lower bound
  for (let i = 1; i < four.length; i++) assert.equal(four[i][0], four[i - 1][1]);
});
