import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "./supabase/server";
import { createSupabaseAdminClient } from "./supabase/admin";
import { safeGetUser } from "./supabase/safe-auth";
import { type Capability, type Role, can, isStaffRole, toRole } from "./roles";

export type SessionInfo = {
  userId: string;
  email: string | null;
  role: Role;
  customerId: string | null;
  /** True when the customer holds an RPT (RetouchPony【リタポ】) contract — forces a gold badge. */
  hasActiveRpt: boolean;
};

// Wrapped in React's cache() so the many Server Components rendered for a
// single request (header, page, HorsesSupportSection, ...) share one
// Supabase auth call instead of each racing to refresh the session cookie.
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  try {
    const supabase = createSupabaseServerClient();
    const { user } = await safeGetUser(supabase);
    if (!user) return null;

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("role, customer_id")
      .eq("id", user.id)
      .maybeSingle();

    let customerId = (profile?.customer_id as string | null) ?? null;
    const role = toRole(profile?.role);

    const admin = createSupabaseAdminClient();

    // Backfill the customer link when it's missing. Two hard rules:
    //  1. Never write on a failed read — a transient profiles read error must
    //     not be mistaken for "no profile" and silently demote a staff account.
    //  2. Never overwrite an existing role — only fill in customer_id. A brand
    //     new login (no profile row yet) is created as "member".
    if (!profileErr && !customerId) {
      const { data: cust } = await admin
        .from("customers")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (cust?.id) {
        customerId = cust.id as string;
        if (profile) {
          await admin
            .from("profiles")
            .update({ customer_id: customerId })
            .eq("id", user.id);
        } else {
          await admin
            .from("profiles")
            .insert({ id: user.id, role: "member", customer_id: customerId });
        }
      }
    }

    let hasActiveRpt = false;
    if (customerId) {
      const { data: rpt } = await admin
        .from("contracts")
        .select("id, membership_plans!inner(code)")
        .eq("customer_id", customerId)
        .eq("membership_plans.code", "RPT")
        .limit(1);
      hasActiveRpt = Array.isArray(rpt) && rpt.length > 0;
    }

    return {
      userId: user.id,
      email: user.email ?? null,
      role,
      customerId,
      hasActiveRpt,
    };
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[auth] getSession failed — treating as logged out.",
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  }
});

export async function requireMember(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Gate for the admin area. Any staff role (owner / admin / moderator) may enter;
 * finer-grained actions are checked with {@link requireCapability}.
 */
export async function requireAdmin(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  if (!isStaffRole(session.role)) {
    redirect("/admin/login?error=forbidden");
  }
  return session;
}

/** Require a specific capability; redirects staff who lack it back to the dashboard. */
export async function requireCapability(capability: Capability): Promise<SessionInfo> {
  const session = await requireAdmin();
  if (!can(session.role, capability)) {
    redirect("/admin?error=forbidden");
  }
  return session;
}

/** Owner-only gate (system/payment settings, role & admin-account management). */
export async function requireOwner(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  if (session.role !== "owner") {
    redirect("/admin?error=forbidden");
  }
  return session;
}
