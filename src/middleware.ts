import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { isStaleSessionError, safeGetUser } from "@/lib/supabase/safe-auth";

const fetchWithTimeout = async (input: RequestInfo | URL, init?: RequestInit) => {
  const timeoutPromise = new Promise<Response>((resolve) => {
    setTimeout(() => {
      resolve(
        new Response(
          JSON.stringify({
            error: "timeout",
            error_description: "Supabase request timed out",
          }),
          {
            status: 504,
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }, 3000);
  });

  return Promise.race([fetch(input, init), timeoutPromise]);
};

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const secure =
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto") === "https";

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    global: { fetch: fetchWithTimeout },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      // Supabase sessions are often split across several chunked cookies
      // (sb-xxx-auth-token.0, .1, ...). setAll() receives them as one batch —
      // `response` must only be recreated ONCE per batch, otherwise each
      // reassignment discards the Set-Cookie headers written for earlier
      // chunks in the same batch, corrupting the session and causing
      // "Invalid Refresh Token" errors on the next request.
      setAll: ((cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request: { headers: request.headers } });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      }) satisfies SetAllCookies,
    },
  });

  const staleCookieNames = request.cookies
    .getAll()
    .map((cookie) => cookie.name)
    .filter(
      (name) =>
        name.startsWith("sb-") &&
        (name.includes("auth-token") || name.includes("code-verifier")),
    );
  const { error } = await safeGetUser(supabase);
  // A revoked refresh token is not a server failure. Drop the dead cookies so
  // the browser stops sending them on every later request.
  if (isStaleSessionError(error)) {
    for (const name of staleCookieNames) {
      response.cookies.set(name, "", {
        path: "/",
        maxAge: 0,
        sameSite: "lax",
        secure,
      });
    }
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon.png|icons|manifest.json|sw.js|workbox|api/stripe/webhook).*)",
  ],
};
