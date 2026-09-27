import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { memberMutationGuard } from "@/lib/memberGuard";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { getBaseUrl } from "@/lib/site";

const schema = z.object({
  amount: z.number().int().min(100).max(10_000_000),
  message: z.string().max(1000).optional().nullable(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const forbidden = memberMutationGuard(session);
  if (forbidden) return forbidden;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }
  const { amount, message } = parsed.data;
  const admin = createSupabaseAdminClient();

  // Save pending donation record first (idempotent handle by webhook completion later)
  const { data: inserted, error: dErr } = await admin
    .from("donations")
    .insert({
      customer_id: session.customerId,
      amount,
      message,
      status: "pending",
      donor_email: session.email,
    })
    .select("id")
    .single();
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });

  const stripe = getStripe();
  if (!stripe) {
    // Dev mode: mark as succeeded immediately for smoke testing
    await admin
      .from("donations")
      .update({ status: "succeeded" })
      .eq("id", inserted.id);
    return NextResponse.json({ ok: true, checkout_url: null });
  }

  const siteUrl = getBaseUrl(req);
  const checkout = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "jpy",
          unit_amount: amount,
          product_data: { name: "Retouchメンバーズサイト 単発寄付" },
        },
      },
    ],
    client_reference_id: inserted.id,
    metadata: {
      donation_id: inserted.id,
      customer_id: session.customerId,
      kind: "donation",
    },
    success_url: `${siteUrl}/mypage/donate/thanks?sid={CHECKOUT_SESSION_ID}`,
    cancel_url: `${siteUrl}/mypage/donate`,
    customer_email: session.email ?? undefined,
  });

  await admin
    .from("donations")
    .update({ stripe_checkout_session_id: checkout.id })
    .eq("id", inserted.id);

  return NextResponse.json({ ok: true, checkout_url: checkout.url });
}
