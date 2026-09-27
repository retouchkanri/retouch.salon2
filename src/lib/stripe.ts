import Stripe from "stripe";

let _stripe: Stripe | null = null;

/**
 * Returns a Stripe client, or null when the secret key is not configured.
 * The app continues to work in "Stripe-disabled" mode for local development
 * before real keys are provided.
 */
export function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith("sk_test_placeholder")) return null;
  _stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion });
  return _stripe;
}

export function isStripeEnabled() {
  return getStripe() !== null;
}
