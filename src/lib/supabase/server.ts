import { cookies } from "next/headers";
import { createServerClient, type SetAllCookies } from "@supabase/ssr";

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

export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: fetchWithTimeout },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        // Chunked session cookies must be written as a single batch (see
        // middleware.ts for why) — Route Handlers/Server Actions can write
        // cookies, Server Components cannot, hence the blanket try/catch.
        setAll: ((cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies cannot be set.
            // Middleware handles token refresh so this is safe to ignore.
          }
        }) satisfies SetAllCookies,
      },
    },
  );
}
