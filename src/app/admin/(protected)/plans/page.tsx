import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { formatYen } from "@/lib/format";
import PlanForm from "./PlanForm";
import PlanRow from "./PlanRow";

export default async function AdminPlansPage() {
  await requireCapability("plans.manage");
  const supabase = createSupabaseServerClient();
  const { data: plans } = await supabase
    .from("membership_plans")
    .select("*")
    .order("is_active", { ascending: false })
    .order("sort_order")
    .order("monthly_amount");

  const activeCount = (plans ?? []).filter((p: any) => p.is_active).length;
  const inactiveCount = (plans ?? []).length - activeCount;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">会員プラン管理</h1>
      <p className="text-sm text-ink-soft">
        A/B/C・特別チーム・支援プランの料金・説明・Stripe価格IDなどを編集できます。
        契約中の顧客がいるプランは削除できません（無効化されます）。
      </p>
      <p className="text-sm text-ink-soft">
        有効 {activeCount} 件 / 無効 {inactiveCount} 件。
        旧名称・旧料金のプランは、過去の契約や決済履歴との紐づきを保つため削除せず「無効」のまま残します
        （無効プランは下部にまとめて薄く表示されます）。新規の会員登録では「有効」プランのみ選択されます。
        旧プランを整理する場合は、各行の「編集」から「有効」チェックを外して無効化してください。
      </p>

      <div className="card border-2 border-brand/20 bg-brand-50/30">
        <h2 className="section-title mb-2">公開ページ：ご入会のご案内</h2>
        <p className="text-sm text-ink-soft mb-3 leading-relaxed">
          会員制度・会員特典・会費の使い道・免責事項などを、一般公開ページで表示しています。
          1口支援制度は
          <Link href="/support-guide" target="_blank" rel="noopener noreferrer" className="text-brand underline mx-1">
            /support-guide
          </Link>
          でもご案内しています。
        </p>
        <Link href="/guide" target="_blank" rel="noopener noreferrer" className="btn-secondary inline-flex">
          /guide をプレビュー
        </Link>
        <Link
          href="/support-guide"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary inline-flex ml-2"
        >
          /support-guide をプレビュー
        </Link>
      </div>

      <details className="card">
        <summary className="cursor-pointer font-semibold">＋ 新しいプランを追加</summary>
        <div className="mt-3">
          <PlanForm />
        </div>
      </details>

      <div className="card p-0 overflow-auto">
        <table className="table">
          <thead>
            <tr>
              <th className="w-12 text-right">No.</th>
              <th>コード</th>
              <th>名称</th>
              <th>月額</th>
              <th>単価</th>
              <th>併用</th>
              <th>Stripe</th>
              <th>有効</th>
              <th>順</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(plans ?? []).map((p: any, i: number) => (
              <PlanRow key={p.id} index={i + 1} plan={p} displayYen={formatYen(p.monthly_amount)} />
            ))}
            {(plans ?? []).length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-6 text-ink-mute">
                  登録されたプランがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
