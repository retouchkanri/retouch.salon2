import { test } from "node:test";
import assert from "node:assert/strict";

test("writeAudit: never throws when the Supabase client is unreachable", async () => {
  // The helper constructs its own admin client via env. With env unset the
  // factory throws — writeAudit must catch that and return a resolved promise.
  const before = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const mod = await import("../src/lib/audit");
    await assert.doesNotReject(
      mod.writeAudit({
        actorId: "00000000-0000-0000-0000-000000000000",
        action: "booking.create",
        targetTable: "bookings",
        targetId: "00000000-0000-0000-0000-000000000001",
        meta: { smoke: true },
      }),
    );
  } finally {
    if (before) process.env.SUPABASE_SERVICE_ROLE_KEY = before;
  }
});
