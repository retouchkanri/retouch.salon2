import type { SupabaseClient, User } from "@supabase/supabase-js";

type GetUserResult = Awaited<ReturnType<SupabaseClient["auth"]["getUser"]>>;

/** Expired or revoked browser cookies. The visitor should continue as logged out. */
export function isStaleSessionError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "string") return /invalid refresh token|refresh token not found/i.test(error);
  if (typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message ?? "") : "";
  const normalized = message.toLowerCase();
  return (
    code === "refresh_token_not_found" ||
    code === "refresh_token_already_used" ||
    code === "session_not_found" ||
    normalized.includes("refresh token") ||
    normalized.includes("invalid refresh")
  );
}

function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("__isAuthError" in error && (error as { __isAuthError?: boolean }).__isAuthError) return true;
  const name = "name" in error ? String((error as { name?: unknown }).name ?? "") : "";
  return name.startsWith("Auth") && name.endsWith("Error");
}

function containsStaleSession(value: unknown): boolean {
  if (isStaleSessionError(value)) return true;
  if (Array.isArray(value)) return value.some(containsStaleSession);
  return false;
}

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

let staleSessionSilenceDepth = 0;
let consoleErrorOriginal: typeof console.error | null = null;

/**
 * Supabase prints AuthApiError for a dead refresh token even when the caller
 * handles the returned error. Hide only that expected case.
 */
function silenceStaleSessionLogs(): () => void {
  if (staleSessionSilenceDepth === 0) {
    consoleErrorOriginal = console.error;
    console.error = (...args: unknown[]) => {
      if (args.some(containsStaleSession)) return;
      consoleErrorOriginal?.(...args);
    };
  }
  staleSessionSilenceDepth += 1;
  return () => {
    staleSessionSilenceDepth -= 1;
    if (staleSessionSilenceDepth === 0 && consoleErrorOriginal) {
      console.error = consoleErrorOriginal;
      consoleErrorOriginal = null;
    }
  };
}

/**
 * Calls Supabase auth.getUser() without letting a dead session or a network
 * failure crash the server. Returns null user when the visitor is logged out
 * or Supabase is unreachable.
 */
export async function safeGetUser(
  supabase: SupabaseClient,
): Promise<{ user: User | null; error: GetUserResult["error"] }> {
  const restoreConsole = silenceStaleSessionLogs();
  try {
    const { data, error } = await supabase.auth.getUser();
    return { user: data.user, error };
  } catch (error) {
    if (isStaleSessionError(error) || isAuthError(error)) {
      return { user: null, error: error as GetUserResult["error"] };
    }
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
  } finally {
    restoreConsole();
  }
}
