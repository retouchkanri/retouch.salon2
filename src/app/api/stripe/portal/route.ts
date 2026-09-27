import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";
import { getBaseUrl } from "@/lib/site";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.customerId) {
    return NextResponse.json({ error: "認証されていません" }, { status: 401 });
  }
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: "Stripe 未設定" }, { status: 503 });

  const admin = createSupabaseAdminClient();
  const { data: c } = await admin
    .from("customers")
    .select("id, email, stripe_customer_id, full_name")
    .eq("id", session.customerId)
    .maybeSingle();
  if (!c) return NextResponse.json({ error: "会員情報がありません" }, { status: 404 });

  let stripeCustomerId = (c as any).stripe_customer_id as string | null;
  if (!stripeCustomerId) {
    const cust = await stripe.customers.create({
      email: (c as any).email ?? undefined,
      name: (c as any).full_name ?? undefined,
      metadata: { customer_id: (c as any).id },
    });
    stripeCustomerId = cust.id;
    await admin.from("customers").update({ stripe_customer_id: cust.id }).eq("id", (c as any).id);
  }

  const siteUrl = getBaseUrl(req);
  const portal = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId!,
    return_url: `${siteUrl}/mypage`,
  });
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/json")) {
    return NextResponse.json({ url: portal.url });
  }
  return NextResponse.redirect(portal.url, { status: 303 });
}
