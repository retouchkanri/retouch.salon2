/**
 * 顧客CSVの末尾に付ける「いまの会員種別と一口支援」の列（I/O なし）。
 * 会員種別・特別参加・支援口数は、顧客一覧（v_customer_summary）と同じ内容にする。
 * これらの列は出力専用。取込（POST）は列名が英字の項目だけを読むので、付いたままの CSV を取り込んでも何も変わらない。
 */
import { formatUnits, memberClassLabel } from "@/lib/format";

export const MEMBERSHIP_COLUMNS = ["会員種別", "特別参加", "支援口数", "支援先と口数"] as const;
export type MembershipColumn = (typeof MEMBERSHIP_COLUMNS)[number];

/** v_customer_summary のうち、この列に使う項目。 */
export type CustomerSummaryRow = {
  customer_id: string;
  member_class_code: string | null;
  primary_plan_name: string | null;
  rpt_active: boolean | null;
  special_team_count: number | null;
  special_team_names: string[] | null;
  total_support_units: number | string | null;
};

/** 一口支援の 1 行。active（支援中）と past_due（決済失敗中）だけを渡す。 */
export type SupportDetailRow = {
  customer_id: string;
  horse_id: string;
  units: number | string | null;
  status: string;
  horse: { name: string | null; sort_order: number | null } | null;
};

/**
 * 顧客一覧の「会員種別」と同じ表示。プランに入っていればその名前、一口支援だけならヘルパーズ会員。
 * どれにも入っていない人は「無料会員」。リタポ・特別チームだけの人は、顧客一覧と同じく「—」（特別参加の列に出る）。
 */
function classLabel(summary: CustomerSummaryRow): string {
  if (summary.primary_plan_name) return summary.primary_plan_name;
  if (summary.member_class_code) return memberClassLabel(summary.member_class_code);
  return summary.rpt_active || (summary.special_team_count ?? 0) > 0 ? "—" : "無料会員";
}

function specialLabel(summary: CustomerSummaryRow): string {
  const parts: string[] = [];
  if (summary.rpt_active) parts.push("リタポメンバー");
  if ((summary.special_team_count ?? 0) > 0) {
    const names = (summary.special_team_names ?? []).filter(Boolean);
    if (names.length === 0) parts.push("特別チーム会員");
    for (const name of names) parts.push(`特別チーム：${name}`);
  }
  return parts.join("、");
}

/**
 * 「誰に何口」。同じ馬への支援が複数行に分かれていれば 1 つにまとめ、馬マスタの並び順で出す。
 * 決済失敗中の支援は、顧客一覧と同じく支援口数には数えないが、消えたように見えないよう注記つきで出す。
 */
function supportDetail(supports: SupportDetailRow[]): string {
  const byHorse = new Map<string, { name: string; order: number; active: number; pastDue: number }>();
  for (const row of supports) {
    const units = Number(row.units) || 0;
    if (units <= 0 || (row.status !== "active" && row.status !== "past_due")) continue;
    const entry = byHorse.get(row.horse_id) ?? {
      name: row.horse?.name?.trim() || "（馬の登録なし）",
      order: row.horse?.sort_order ?? Number.MAX_SAFE_INTEGER,
      active: 0,
      pastDue: 0,
    };
    if (row.status === "active") entry.active += units;
    else entry.pastDue += units;
    byHorse.set(row.horse_id, entry);
  }
  return [...byHorse.values()]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"))
    .flatMap((horse) => [
      ...(horse.active > 0 ? [`${horse.name}に${formatUnits(horse.active)}`] : []),
      ...(horse.pastDue > 0 ? [`${horse.name}に${formatUnits(horse.pastDue)}（決済失敗中）`] : []),
    ])
    .join("、");
}

/** 顧客 1 人分の列。summary が無い（集計ビューに出てこない）顧客は空欄にする。 */
export function membershipColumns(
  summary: CustomerSummaryRow | undefined,
  supports: SupportDetailRow[],
): Record<MembershipColumn, string | number> {
  const units = Number(summary?.total_support_units) || 0;
  return {
    会員種別: summary ? classLabel(summary) : "",
    特別参加: summary ? specialLabel(summary) : "",
    支援口数: units > 0 ? units : "",
    支援先と口数: supportDetail(supports),
  };
}
