/**
 * 無料会員の内訳（I/O なし）。メッセージ配信の配信対象「無料会員①」「無料会員②」に使う。
 *   ① 寄付のある方
 *   ② 寄付も会費・一口支援の支払いもなく、登録から FREE_IDLE_MONTHS か月以上たった方
 * どちらでもない無料会員（登録して間もない方、以前に会費・一口支援を支払っていた方）は、①にも②にも入れない。
 */

/** 登録からこの月数がたっても寄付のない無料会員を ② とする。 */
export const FREE_IDLE_MONTHS = 2;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * donor  = ① 寄付のある方
 * idle   = ② 寄付も支払いもなく、登録から 2 か月以上
 * recent = 寄付も支払いもないが、登録から 2 か月たっていない
 * former = 寄付はないが、以前に会費・一口支援を支払っていた（退会・解約して無料会員になった方）
 */
export type FreeMemberGroup = "donor" | "idle" | "recent" | "former";

/** 配信対象の値と、その中身。 */
export const FREE_GROUP_AUDIENCES = { no_class_donor: "donor", no_class_idle: "idle" } as const satisfies Record<string, FreeMemberGroup>;
export type FreeGroupAudience = keyof typeof FREE_GROUP_AUDIENCES;

export const FREE_GROUP_LABELS: Record<FreeGroupAudience, string> = {
  no_class_donor: "無料会員①：寄付のある方",
  no_class_idle: `無料会員②：寄付がなく、登録から${FREE_IDLE_MONTHS}か月以上の方`,
};

export function isFreeGroupAudience(value: string | null | undefined): value is FreeGroupAudience {
  return value != null && Object.prototype.hasOwnProperty.call(FREE_GROUP_AUDIENCES, value);
}

export type FreeMemberRow = { id: string; email: string | null; joined_at: string | null; created_at: string };
/** donations の行。 */
export type DonationMark = { customer_id: string | null; donor_email: string | null; status: string; payment_method: string | null };
/** payments の行（成功した決済だけを渡す）。kind は subscription / donation / one_time。 */
export type PaymentMark = { customer_id: string | null; kind: string; status: string };

export type FreeGroupCounts = Record<FreeMemberGroup, number>;

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * 寄付として数える記録か。入金済みのほか、銀行振込の申告（着金確認待ち）も数える。
 * 振り込んだ可能性のある方を「寄付がない」側に入れて、案内を送ってしまわないため。
 * カードで手続きを始めただけで決済していないもの（カードの pending）は数えない。
 */
function countsAsDonation(row: DonationMark): boolean {
  return row.status === "succeeded" || (row.status === "pending" && row.payment_method === "bank_transfer");
}

/**
 * 日本時間の暦で months か月前の同じ時刻。
 * 月末は、その月の末日に寄せる（12/31 の 2 か月前は 10/31、4/30 の 2 か月前は 2 月の末日）。
 */
export function monthsAgo(now: Date, months: number): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() - months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const shifted = Date.UTC(
    year,
    month,
    Math.min(jst.getUTCDate(), lastDay),
    jst.getUTCHours(),
    jst.getUTCMinutes(),
    jst.getUTCSeconds(),
    jst.getUTCMilliseconds(),
  );
  return new Date(shifted - JST_OFFSET_MS);
}

/** members は無料会員だけを渡す。会員ごとの区分を返す。 */
export function classifyFreeMembers(
  members: FreeMemberRow[],
  donations: DonationMark[],
  payments: PaymentMark[],
  now: Date = new Date(),
): Map<string, FreeMemberGroup> {
  const memberIds = new Set(members.map((member) => member.id));
  const idByEmail = new Map<string, string>();
  for (const member of members) {
    const email = normalizeEmail(member.email);
    if (email) idByEmail.set(email, member.id);
  }

  const donors = new Set<string>();
  const formerPayers = new Set<string>();
  for (const row of donations) {
    if (!countsAsDonation(row)) continue;
    // 会員に紐づいていない寄付は、寄付者のメールアドレスが会員のものと同じなら、その会員の寄付とみなす。
    const owner = row.customer_id ?? idByEmail.get(normalizeEmail(row.donor_email));
    if (owner && memberIds.has(owner)) donors.add(owner);
  }
  for (const row of payments) {
    if (row.status !== "succeeded" || !row.customer_id || !memberIds.has(row.customer_id)) continue;
    // 定期課金（会費・一口支援）以外の決済は、Stripe での単発の寄付。
    if (row.kind === "subscription") formerPayers.add(row.customer_id);
    else donors.add(row.customer_id);
  }

  const cutoff = monthsAgo(now, FREE_IDLE_MONTHS).getTime();
  const groups = new Map<string, FreeMemberGroup>();
  for (const member of members) {
    if (donors.has(member.id)) groups.set(member.id, "donor");
    else if (formerPayers.has(member.id)) groups.set(member.id, "former");
    else {
      const joined = new Date(member.joined_at ?? member.created_at).getTime();
      // 登録日が読めない会員は、案内を送る側（②）には入れない。
      groups.set(member.id, Number.isFinite(joined) && joined <= cutoff ? "idle" : "recent");
    }
  }
  return groups;
}

export function countFreeGroups(groups: ReadonlyMap<string, FreeMemberGroup>): FreeGroupCounts {
  const counts: FreeGroupCounts = { donor: 0, idle: 0, recent: 0, former: 0 };
  for (const group of groups.values()) counts[group] += 1;
  return counts;
}
