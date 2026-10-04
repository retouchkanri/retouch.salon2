import { fetchAllRows } from "@/lib/fetchAll";
import { HIDDEN_ACCOUNT_EMAILS } from "@/lib/hiddenAccounts";
import { buildFollowUps, type FollowUp } from "@/lib/followUp";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function loadFollowUps(now = new Date()): Promise<{ rows: FollowUp[]; loginError: string | null }> {
  const admin = createSupabaseAdminClient();
  const since = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();
  const [customers, contracts, supports, payments] = await Promise.all([
    fetchAllRows<{ id: string; full_name: string; email: string | null; status: string; auth_user_id: string | null; joined_at: string | null }>((from, to) =>
      admin.from("customers").select("id, full_name, email, status, auth_user_id, joined_at").order("id").range(from, to),
    ),
    fetchAllRows<{ customer_id: string; status: string; canceled_at: string | null }>((from, to) =>
      admin.from("contracts").select("customer_id, status, canceled_at").order("id").range(from, to),
    ),
    fetchAllRows<{ customer_id: string; monthly_amount: number; status: string; started_at: string; canceled_at: string | null }>((from, to) =>
      admin.from("support_subscriptions").select("customer_id, monthly_amount, status, started_at, canceled_at").order("id").range(from, to),
    ),
    fetchAllRows<{ customer_id: string | null; status: string; occurred_at: string; failure_reason: string | null }>((from, to) =>
      admin.from("payments").select("customer_id, status, occurred_at, failure_reason").eq("status", "failed").gte("occurred_at", since).order("id").range(from, to),
    ),
  ]);
  const failed = [customers, contracts, supports, payments].find((result) => result.error);
  if (failed?.error) throw new Error(failed.error.message ?? "要フォローの集計に失敗しました。");

  const logins: { authUserId: string; lastSignInAt: string | null }[] = [];
  let loginError: string | null = null;
  try {
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const users = data?.users ?? [];
      for (const user of users) logins.push({ authUserId: user.id, lastSignInAt: user.last_sign_in_at ?? null });
      if (users.length < 1000) break;
    }
  } catch {
    loginError = "最終ログインは読み込めませんでした。それ以外の条件で表示しています。";
  }

  return {
    rows: buildFollowUps(
      {
        customers: customers.rows.map((row) => ({
          id: row.id,
          name: row.full_name,
          email: row.email,
          status: row.status,
          authUserId: row.auth_user_id,
          joinedAt: row.joined_at,
        })),
        contracts: contracts.rows.map((row) => ({
          customerId: row.customer_id,
          status: row.status,
          canceledAt: row.canceled_at,
        })),
        supports: supports.rows.map((row) => ({
          customerId: row.customer_id,
          monthlyAmount: Number(row.monthly_amount) || 0,
          status: row.status,
          startedAt: row.started_at,
          canceledAt: row.canceled_at,
        })),
        payments: payments.rows.map((row) => ({
          customerId: row.customer_id,
          status: row.status,
          occurredAt: row.occurred_at,
          failureReason: row.failure_reason,
        })),
        logins,
        hiddenEmails: HIDDEN_ACCOUNT_EMAILS,
      },
      now,
    ),
    loginError,
  };
}
