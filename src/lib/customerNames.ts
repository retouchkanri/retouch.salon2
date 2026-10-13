import { fetchAllByIds } from "@/lib/fetchAll";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/** 顧客 ID → 氏名とニックネーム。管理画面で「誰が」を出すときに使う。 */
export type CustomerNames = Record<string, { name: string; nickname: string | null }>;

/**
 * 顧客 ID から、氏名とニックネーム（full_name_kana。読み仮名ではなくニックネームの項目）を引く。
 * 読み込めなかった分は入らない（画面側は、名前なしでも顧客情報へのリンクを出す）。
 */
export async function loadCustomerNames(admin: Admin, ids: string[]): Promise<CustomerNames> {
  const unique = [...new Set(ids.filter(Boolean))];
  const { rows } = await fetchAllByIds<{ id: string; full_name: string | null; full_name_kana: string | null }>(
    unique,
    (chunk, from, to) => admin.from("customers").select("id, full_name, full_name_kana").in("id", chunk).order("id").range(from, to),
  );
  const names: CustomerNames = {};
  for (const row of rows) {
    const name = (row.full_name ?? "").trim();
    const nickname = (row.full_name_kana ?? "").trim();
    names[row.id] = { name, nickname: nickname && nickname !== name ? nickname : null };
  }
  return names;
}
