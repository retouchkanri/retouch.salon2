import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/auth";
import { syncStripePayments } from "@/lib/stripeSync";
import { reconcileSubscriptionStatuses } from "@/lib/stripeReconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { full?: boolean } — pull Stripe payments into the local payments table.
// full=true reconciles the whole history (backfill); default is incremental.
export async function POST(req: Request) {
  await requireCapability("payments.manage");
  const body = await req.json().catch(() => ({}));
  const full = Boolean((body as any)?.full);
  try {
    const result = await syncStripePayments({ full });
    if (result.reason === "stripe_disabled") {
      return NextResponse.json({ error: "Stripeが未設定です（STRIPE_SECRET_KEY）。" }, { status: 503 });
    }
    // 支援契約の状態も Stripe の実状態へ同期する（Webhook 取りこぼしで
    // incomplete のまま固着した決済支援を active に復帰させる）。
    // full=true のときは全契約、通常は incomplete/past_due のみを対象。
    const reconcile = await reconcileSubscriptionStatuses({ onlyPending: !full }).catch(() => null);
    return NextResponse.json({ ok: true, ...result, reconcile });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "同期に失敗しました" }, { status: 500 });
  }
}
