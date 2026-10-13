import SignalList from "@/components/admin/SignalList";
import { loadCustomerNames, type CustomerNames } from "@/lib/customerNames";
import { buildGivingInsight, moverCustomerIds } from "@/lib/donationInsight";
import { currentYearMonth } from "@/lib/monthlyReport";
import { loadReportSource } from "@/lib/monthlyReportData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function OpsSignals() {
  try {
    const admin = createSupabaseAdminClient();
    const { source, error } = await loadReportSource(admin);
    if (error || !source) return null;
    const insight = buildGivingInsight(source, currentYearMonth());
    if (!insight) return null;
    // 口数を増やした人・支援を停止した人の名前。読み込めなくても、数字はそのまま出す。
    const names: CustomerNames = await loadCustomerNames(admin, moverCustomerIds(insight)).catch(() => ({}));
    return <SignalList signals={insight.signals} bright={insight.bright} names={names} />;
  } catch {
    return null;
  }
}
