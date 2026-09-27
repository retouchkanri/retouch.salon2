import type { SupabaseClient, User } from "@supabase/supabase-js";

type GetUserResult = Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>;

function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("abort") ||
    error.name === "HeadersTimeoutError" ||
    error.name === "ConnectTimeoutError" ||
    error.name === "AbortError"
  );
}

/**
 * Calls Supabase auth.getUser() without letting network failures crash the server.
 * Returns null user when Supabase is unreachable (offline dev, firewall, etc.).
 */
export async function safeGetUser(
  supabase: SupabaseClient,
): Promise<{ user: User | null; error: GetUserResult["error"] }> {
  try {
    const { data, error } = await supabase.auth.getUser();
    return { user: data.user, error };
  } catch (error) {
    if (isNetworkError(error)) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[auth] Supabase unreachable — continuing without session refresh.",
          error instanceof Error ? error.message : error,
        );
      }
      return { user: null, error: null };
    }
    throw error;
  }
}
