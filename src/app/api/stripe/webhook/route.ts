import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  donationThanksTemplate,
  notify,
  paymentFailedTemplate,
  staffRecipients,
} from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }
  const sig = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!sig || !secret) return NextResponse.json({ error: "bad request" }, { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (e: any) {
    return NextResponse.json({ error: `Webhook signature error: ${e.message}` }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const donationId = (session.metadata?.donation_id ?? session.client_reference_id) as string | undefined;
        if (session.mode === "payment" && donationId) {
          await admin
            .from("donations")
            .update({
              status: "succeeded",
              stripe_payment_intent_id: (session.payment_intent as string) ?? null,
              donated_at: new Date(session.created * 1000).toISOString(),
            })
            .eq("id", donationId);
          const { data: donation } = await admin.from("donations").select("*").eq("id", donationId).maybeSingle();
          if (donation) {
            // Stripe may redeliver the same event (retry on timeout/non-2xx),
            // so guard the insert against creating a second payments row for
            // the same donation — otherwise the donor's history shows the
            // same transaction twice.
            const { data: existingPayment } = await admin
              .from("payments")
              .select("id")
              .eq("donation_id", (donation as any).id)
              .maybeSingle();
            if (!existingPayment) {
              await admin.from("payments").insert({
                customer_id: (donation as any).customer_id,
                donation_id: (donation as any).id,
                kind: "donation",
                amount: (donation as any).amount,
                currency: "jpy",
                status: "succeeded",
                stripe_event_id: event.id,
                stripe_payment_intent_id: (session.payment_intent as string) ?? null,
                occurred_at: new Date(session.created * 1000).toISOString(),
                raw: session as any,
              });
            }

            // Send thank-you email
            const donorEmail = (donation as any).donor_email
              || session.customer_details?.email
              || session.customer_email
              || null;
            let donorName = (donation as any).donor_name as string | null;
            if (!donorName && (donation as any).customer_id) {
              const { data: cust } = await admin
                .from("customers")
                .select("full_name")
                .eq("id", (donation as any).customer_id)
                .maybeSingle();
              donorName = (cust as any)?.full_name ?? null;
            }
            const tpl = donationThanksTemplate({
              name: donorName,
              amount: (donation as any).amount,
            });
            await notify({
              kind: "donation_thanks",
              to: donorEmail,
              to_name: donorName,
              subject: tpl.subject,
              body_text: tpl.body_text,
              meta: { donation_id: (donation as any).id, session_id: session.id },
            });

            // 運営への寄付受領通知（送信失敗は処理に影響させない）
            await notify({
              kind: "staff_notify",
              to: staffRecipients(),
              subject: `【寄付】${donorName ?? "匿名"} 様 — ¥${Math.round((donation as any).amount).toLocaleString("ja-JP")}`,
              body_text:
                `単発寄付の決済が完了しました。\n\n` +
                `・お名前: ${donorName ?? "（匿名）"}\n` +
                `・メール: ${donorEmail ?? "—"}\n` +
                `・金額: ¥${Math.round((donation as any).amount).toLocaleString("ja-JP")}\n` +
                ((donation as any).message ? `・メッセージ: ${(donation as any).message}\n` : ""),
              reply_to: donorEmail ?? undefined,
              meta: { donation_id: (donation as any).id, session_id: session.id, source: "donation" },
            });
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;

        // --- 特別チーム会員の専用サブスクは contracts へ書き込まず、
        //     special_team_memberships のみ更新する（既存ロジックと分離）。
        if (sub.metadata?.kind === "special_team") {
          const stMapped =
            sub.status === "active" ? "active" :
            sub.status === "past_due" ? "past_due" :
            sub.status === "canceled" ? "canceled" :
            sub.status === "incomplete" || sub.status === "incomplete_expired" ? "incomplete" : "active";
          const stPeriodEnd = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;
          await admin
            .from("special_team_memberships")
            .update({
              status: stMapped,
              canceled_at: sub.cancel_at_period_end ? stPeriodEnd : null,
            })
            .eq("stripe_subscription_id", sub.id)
            .in("status", ["active", "past_due", "incomplete"]);
          break;
        }

        const stripeCustomerId = sub.customer as string;
        const { data: customer } = await admin
          .from("customers")
          .select("id")
          .eq("stripe_customer_id", stripeCustomerId)
          .maybeSingle();
        if (customer) {
          const mappedStatus =
            sub.status === "active" ? "active" :
            sub.status === "past_due" ? "past_due" :
            sub.status === "canceled" ? "canceled" :
            sub.status === "paused" ? "paused" : "incomplete";
          const currentPeriodEndIso = sub.current_period_end
            ? new Date(sub.current_period_end * 1000).toISOString()
            : null;

          // For a brand-new subscription, this "created" webhook can arrive
          // BEFORE our own API request (which created the subscription) has
          // finished writing stripe_subscription_id onto the contract it
          // just made. Upserting on conflict=stripe_subscription_id then
          // finds no match and INSERTS a stray duplicate contract row (with
          // plan_id null) instead of updating the real one — reported
          // 2026-08-27: a customer ended up with two contracts, one orphaned
          // with plan_id=null. Every subscription-creating flow
          // (stripeSupport.ts / plan.ts) stamps `metadata.contract_id`, so
          // prefer that exact match first.
          const metaContractId = (sub.metadata as any)?.contract_id as string | undefined;
          const { data: byMeta } = metaContractId
            ? await admin.from("contracts").select("id").eq("id", metaContractId).maybeSingle()
            : { data: null };
          if (byMeta) {
            await admin
              .from("contracts")
              .update({
                stripe_subscription_id: sub.id,
                status: mappedStatus,
                current_period_end: currentPeriodEndIso,
              })
              .eq("id", (byMeta as any).id);
          } else {
            await admin.from("contracts").upsert(
              {
                customer_id: (customer as any).id,
                stripe_subscription_id: sub.id,
                status: mappedStatus,
                current_period_end: currentPeriodEndIso,
              },
              { onConflict: "stripe_subscription_id" },
            );
          }

          // 紐づく contract の支援行にも同じステータスを反映。
          //  - active   : 会員画面で「正常」表示
          //  - past_due : 「決済失敗」表示
          //  - incomplete: 「手続き中」表示
          // 停止予定（cancel_at_period_end=true）は
          //   status=active + canceled_at=current_period_end として保持。
          const { data: contract } = await admin
            .from("contracts")
            .select("id")
            .eq("stripe_subscription_id", sub.id)
            .maybeSingle();
          if (contract) {
            const supportStatus =
              mappedStatus === "canceled" ? "canceled" :
              mappedStatus === "past_due" ? "past_due" :
              mappedStatus === "incomplete" ? "incomplete" : "active";
            await admin
              .from("support_subscriptions")
              .update({
                status: supportStatus,
                canceled_at: sub.cancel_at_period_end ? currentPeriodEndIso : null,
              })
              .eq("contract_id", (contract as any).id)
              .in("status", ["active", "past_due", "incomplete"]);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const nowIso = new Date().toISOString();

        // --- 特別チーム会員の専用サブスク削除は専用テーブルのみ更新 ---
        if (sub.metadata?.kind === "special_team") {
          await admin
            .from("special_team_memberships")
            .update({ status: "canceled", canceled_at: nowIso, stripe_subscription_item_id: null })
            .eq("stripe_subscription_id", sub.id)
            .in("status", ["active", "past_due", "incomplete"]);
          break;
        }

        await admin
          .from("contracts")
          .update({ status: "canceled", canceled_at: nowIso })
          .eq("stripe_subscription_id", sub.id);

        const { data: contract } = await admin
          .from("contracts")
          .select("id")
          .eq("stripe_subscription_id", sub.id)
          .maybeSingle();
        if (contract) {
          await admin
            .from("support_subscriptions")
            .update({
              status: "canceled",
              canceled_at: nowIso,
              stripe_subscription_item_id: null,
            })
            .eq("contract_id", (contract as any).id)
            .in("status", ["active", "past_due", "incomplete"]);
        }
        break;
      }

      case "invoice.payment_succeeded":
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const stripeCustomerId = invoice.customer as string;
        const { data: customer } = await admin
          .from("customers")
          .select("id")
          .eq("stripe_customer_id", stripeCustomerId)
          .maybeSingle();

        // Stripe can deliver the SAME webhook event more than once (retry on
        // timeout/slow response), and our previous code unconditionally
        // inserted a `payments` row every time — causing the same real
        // charge to show up 2-3 times in a supporter's history (reported
        // 2026-08: same invoice/timestamp, 2 succeeded + 1 failed rows for a
        // single real charge). `event.id` is stable across redeliveries of
        // the same event, so skip if we've already recorded it.
        const { data: alreadyRecorded } = await admin
          .from("payments")
          .select("id")
          .eq("stripe_event_id", event.id)
          .maybeSingle();
        if (alreadyRecorded) break;

        // Smart Retries can resolve a failed charge moments later with a
        // separate "invoice.payment_succeeded" event, but by the time we
        // process a stale "invoice.payment_failed" event the invoice may
        // already be paid — re-check its live status so we don't send a
        // false "payment failed" email / demote the contract to past_due
        // for a payment that actually succeeded (reported 2026-08: card was
        // charged once successfully but a payment_failed email still arrived).
        let effectiveType: typeof event.type = event.type;
        if (event.type === "invoice.payment_failed") {
          try {
            const fresh = await stripe.invoices.retrieve(invoice.id);
            if (fresh.status === "paid") effectiveType = "invoice.payment_succeeded";
          } catch {
            // Keep treating as failed if we can't verify the live status.
          }
        }
        const isSucceeded = effectiveType === "invoice.payment_succeeded";

        // --- 特別チーム会員の専用サブスク請求は専用テーブルを更新 ---
        if (invoice.subscription) {
          const { data: stRows } = await admin
            .from("special_team_memberships")
            .select("id")
            .eq("stripe_subscription_id", invoice.subscription as string)
            .limit(1);
          if (stRows && stRows.length > 0) {
            await admin.from("payments").insert({
              customer_id: (customer as any)?.id ?? null,
              kind: "subscription",
              amount: invoice.amount_paid || invoice.amount_due || 0,
              currency: invoice.currency,
              status: isSucceeded ? "succeeded" : "failed",
              stripe_event_id: event.id,
              stripe_invoice_id: invoice.id,
              failure_reason: !isSucceeded ? (invoice.last_finalization_error?.message ?? null) : null,
              occurred_at: new Date((invoice.status_transitions.paid_at ?? invoice.created) * 1000).toISOString(),
              raw: invoice as any,
            });
            const newStatus = isSucceeded ? "active" : "past_due";
            await admin
              .from("special_team_memberships")
              .update({ status: newStatus })
              .eq("stripe_subscription_id", invoice.subscription as string)
              .in("status", ["active", "past_due", "incomplete"]);
            if (!isSucceeded) {
              const { data: fullCust } = await admin
                .from("customers")
                .select("full_name, email")
                .eq("id", (customer as any)?.id)
                .maybeSingle();
              const tpl = paymentFailedTemplate({
                name: (fullCust as any)?.full_name ?? null,
                contractId: invoice.subscription as string,
              });
              await notify({
                kind: "payment_failed",
                to: (fullCust as any)?.email ?? null,
                to_name: (fullCust as any)?.full_name ?? null,
                subject: tpl.subject,
                body_text: tpl.body_text,
                meta: { special_team_subscription: invoice.subscription, invoice_id: invoice.id },
              });
            }
            break;
          }
        }
        const { data: contract } = invoice.subscription
          ? await admin
              .from("contracts")
              .select("id, status")
              .eq("stripe_subscription_id", invoice.subscription as string)
              .maybeSingle()
          : { data: null } as any;

        await admin.from("payments").insert({
          customer_id: (customer as any)?.id ?? null,
          contract_id: (contract as any)?.id ?? null,
          kind: "subscription",
          amount: invoice.amount_paid || invoice.amount_due || 0,
          currency: invoice.currency,
          status: isSucceeded ? "succeeded" : "failed",
          stripe_event_id: event.id,
          stripe_invoice_id: invoice.id,
          failure_reason: !isSucceeded ? (invoice.last_finalization_error?.message ?? null) : null,
          occurred_at: new Date((invoice.status_transitions.paid_at ?? invoice.created) * 1000).toISOString(),
          raw: invoice as any,
        });

        // --- 決済失敗 → past_due 化 + メール通知 ---
        if (!isSucceeded && contract) {
          await admin.from("contracts").update({ status: "past_due" }).eq("id", (contract as any).id);
          await admin
            .from("support_subscriptions")
            .update({ status: "past_due" })
            .eq("contract_id", (contract as any).id)
            .in("status", ["active", "incomplete"]);

          const { data: fullCust } = await admin
            .from("customers")
            .select("full_name, email")
            .eq("id", (customer as any)?.id)
            .maybeSingle();
          const tpl = paymentFailedTemplate({
            name: (fullCust as any)?.full_name ?? null,
            contractId: (contract as any).id,
          });
          await notify({
            kind: "payment_failed",
            to: (fullCust as any)?.email ?? null,
            to_name: (fullCust as any)?.full_name ?? null,
            subject: tpl.subject,
            body_text: tpl.body_text,
            meta: {
              contract_id: (contract as any).id,
              invoice_id: invoice.id,
            },
          });
        }

        // --- 決済成功 → past_due から復帰 + next_period_end 更新 ---
        if (isSucceeded && contract) {
          const nextPeriodEnd = invoice.lines?.data?.[0]?.period?.end;
          await admin
            .from("contracts")
            .update({
              status: "active",
              current_period_end: nextPeriodEnd
                ? new Date(nextPeriodEnd * 1000).toISOString()
                : undefined,
            })
            .eq("id", (contract as any).id);
          await admin
            .from("support_subscriptions")
            .update({ status: "active" })
            .eq("contract_id", (contract as any).id)
            .in("status", ["past_due", "incomplete"]);
        }
        break;
      }
      default:
        break;
    }
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
