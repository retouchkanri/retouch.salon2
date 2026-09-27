/**
 * Resolve the public base URL for building absolute redirect URLs
 * (Stripe Checkout success/cancel, billing portal return, etc.).
 *
 * Priority:
 *   1. NEXT_PUBLIC_SITE_URL — only when it points at a real (non-local) host.
 *   2. The incoming request's forwarded host (correct on Vercel/proxies).
 *   3. VERCEL_URL (build/runtime provided by Vercel).
 *   4. localhost fallback for local dev.
 *
 * This guards against the common production mistake of leaving
 * NEXT_PUBLIC_SITE_URL set to http://localhost:3000, which would otherwise
 * redirect paying users back to localhost.
 */
const isLocal = (u?: string | null): boolean =>
  !u || /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(u);

export function getBaseUrl(req?: Request): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");
  if (env && !isLocal(env)) return env;

  if (req) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (host && !isLocal(host)) return `${proto}://${host}`;
    try {
      const origin = new URL(req.url).origin;
      if (!isLocal(origin)) return origin;
    } catch {
      // ignore
    }
  }

  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return env || "http://localhost:3000";
}
