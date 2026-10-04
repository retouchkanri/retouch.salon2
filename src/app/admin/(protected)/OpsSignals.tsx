import SignalList from "@/components/admin/SignalList";
import { buildGivingInsight } from "@/lib/donationInsight";
import { currentYearMonth } from "@/lib/monthlyReport";
import { loadReportSource } from "@/lib/monthlyReportData";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export default async function OpsSignals() {
  try {
    const { source, error } = await loadReportSource(createSupabaseAdminClient());
    if (error || !source) return null;
    const insight = buildGivingInsight(source, currentYearMonth());
    if (!insight) return null;
    return <SignalList signals={insight.signals} bright={insight.bright} />;
  } catch {
    return null;
  }
}
