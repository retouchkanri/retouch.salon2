/**
 * Legacy spreadsheet → internal-row mapping for the "既存CSV移行" tool.
 *
 * The client's existing membership management lives in
 * `管理データー【管理厳重】.xlsx`. When exported as CSV the columns appear in
 * Japanese, vary in casing/spacing, and one customer typically spans multiple
 * rows (one row per supported horse).  This module turns that raw CSV table
 * into a structured set of customer payloads that the admin route can write
 * straight to Supabase.
 *
 * It is pure (no DB / network), which keeps it covered by unit tests and
 * reusable from both the API route and the seed-from-xlsx script.
 */

export type LegacyRow = {
  rowNumber: number; // 1-based line number in the source CSV (incl. header)
  contractDate: string | null; // ISO yyyy-mm-dd
  horseName: string | null;
  units: number | null;
  status: string | null; // raw label, e.g. "継続中"
  remark: string | null;
  fullName: string | null;
  fullNameKana: string | null;
  rank: string | null;
  email: string | null;
  phone: string | null;
  postalCode: string | null;
  address: string | null;
  stripeCustomerId: string | null;
};

export type LegacyPlanKey = { code: string; name: string };

export type LegacySupport = {
  rowNumber: number;
  horseName: string;
  units: number;
  contractDate: string | null;
};

export type LegacyCustomer = {
  email: string;
  fullName: string;
  fullNameKana: string | null;
  phone: string | null;
  postalCode: string | null;
  address: string | null;
  status: "active" | "suspended" | "withdrawn";
  stripeCustomerId: string | null;
  plan: LegacyPlanKey | null;
  contractStartedAt: string | null;
  supports: LegacySupport[];
  sourceRows: number[];
};

/** Canonical → list of aliases (lower-cased, whitespace-collapsed). */
const HEADER_ALIASES: Record<keyof LegacyRow | "_skip", string[]> = {
  rowNumber: [],
  contractDate: ["契約日", "申込日", "開始日", "contract_date", "started_at"],
  horseName: ["馬名", "支援馬", "担当馬", "馬", "horse", "horse_name"],
  units: ["口数", "口", "units", "支援口数"],
  status: ["状態", "ステータス", "status"],
  remark: ["備考", "メモ", "コメント", "remark", "note"],
  fullName: ["氏名", "お名前", "名前", "会員名", "full_name", "name"],
  fullNameKana: [
    "ふりがな",
    "フリガナ",
    "カナ",
    "ニックネーム",
    "氏名カナ",
    "full_name_kana",
    "kana",
  ],
  rank: ["ランク", "会員種別", "会員ランク", "プラン", "rank", "plan"],
  email: ["メール", "メールアドレス", "eメール", "email", "mail"],
  phone: ["電話", "電話番号", "tel", "phone"],
  postalCode: ["郵便番号", "〒", "postal_code", "zip"],
  address: ["住所", "所在地", "address", "address1"],
  stripeCustomerId: ["stripe顧客id", "stripe_customer_id", "stripeid"],
  _skip: [],
};

function normHeader(h: string): string {
  return h.replace(/\s+/g, "").replace(/[\(\)（）：:]/g, "").toLowerCase();
}

/**
 * Build an index map: column index → canonical key. Unrecognised headers
 * are silently ignored, which is desirable because the source spreadsheet
 * has a couple of bookkeeping columns we don't care about.
 */
export function buildHeaderIndex(
  header: string[],
): Partial<Record<keyof LegacyRow, number>> {
  const aliasToKey = new Map<string, keyof LegacyRow>();
  (Object.keys(HEADER_ALIASES) as (keyof typeof HEADER_ALIASES)[]).forEach(
    (key) => {
      if (key === "rowNumber" || key === "_skip") return;
      for (const alias of HEADER_ALIASES[key]) {
        aliasToKey.set(normHeader(alias), key);
      }
    },
  );
  const out: Partial<Record<keyof LegacyRow, number>> = {};
  header.forEach((raw, idx) => {
    const norm = normHeader(raw);
    const key = aliasToKey.get(norm);
    if (key && out[key] === undefined) out[key] = idx;
  });
  return out;
}

function cell(row: string[], idx: number | undefined): string | null {
  if (idx === undefined) return null;
  const v = row[idx];
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function parseUnits(raw: string | null): number | null {
  if (!raw) return null;
  // Normalise common Japanese fragments: "1口", "半口", "0.5口"
  if (/半口|半/.test(raw) && !/[0-9]/.test(raw)) return 0.5;
  const cleaned = raw.replace(/口|名|くち/gi, "").trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  // Already ISO-ish?
  const isoMatch = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // 2024年4月1日 / 2024年4月1
  const jp = raw.match(/^(\d{4})年(\d{1,2})月(\d{1,2})/);
  if (jp) {
    const [, y, m, d] = jp;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Excel serial leakage (rare in CSV but be defensive)
  const n = Number(raw);
  if (Number.isFinite(n) && n > 10000 && n < 60000) {
    const ms = (n - 25569) * 86400 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  // Fallback: try Date.parse
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function normaliseEmail(raw: string | null): string | null {
  if (!raw) return null;
  const e = raw.trim().toLowerCase();
  if (!e.includes("@") || e.length < 5) return null;
  return e;
}

function pickStatus(raw: string | null): "active" | "suspended" | "withdrawn" {
  if (!raw) return "active";
  const s = raw.trim();
  if (/退会|脱退|削除|withdraw/i.test(s)) return "withdrawn";
  if (/休止|停止|保留|suspend|pause/i.test(s)) return "suspended";
  return "active";
}

/**
 * Map free-form rank labels to a (code, name) pair on `membership_plans`.
 * Returns null for "無料 / 一般" rows that should not create a contract.
 *
 * Mirrors the mapping in scripts/seed-from-xlsx.ts, but adds explicit
 * "B/A/C会員" keywords because some CSV exports use the short rank codes.
 */
export function rankToPlan(rank: string | null): LegacyPlanKey | null {
  if (!rank) return null;
  const r = rank.trim();
  if (!r || /無料|一般/.test(r)) return null;
  if (/メンバーズ|^b会員|^b$/i.test(r)) return { code: "B", name: "B会員" };
  if (/アテンダー|^a会員|^a$/i.test(r)) return { code: "A", name: "A会員" };
  if (/オーナーズ/i.test(r)) return { code: "OWNER", name: "オーナーズ会員" };
  if (/リェリーフ|リリーフ|^c会員|^c$/i.test(r)) return { code: "C", name: "リェリーフ会員" };
  if (/retouch|rpt|ポニー|サポーター|特別/i.test(r))
    return { code: "SPECIAL_TEAM", name: "特別チーム会員" };
  if (/半口/.test(r)) return { code: "SUPPORT", name: "半口支援" };
  if (/支援/.test(r)) return { code: "SUPPORT", name: "1口支援" };
  return null;
}

export function parseLegacyTable(table: string[][]): {
  rows: LegacyRow[];
  headerWarnings: string[];
} {
  if (table.length === 0) return { rows: [], headerWarnings: ["CSVが空です"] };
  const [header, ...body] = table;
  const idx = buildHeaderIndex(header);
  const headerWarnings: string[] = [];
  if (idx.email === undefined && idx.fullName === undefined) {
    headerWarnings.push(
      "氏名 / メール 列が見つかりません。ヘッダ名を確認してください。",
    );
  }

  const rows: LegacyRow[] = body.map((raw, i) => ({
    rowNumber: i + 2, // 1-based + skip header
    contractDate: parseDate(cell(raw, idx.contractDate)),
    horseName: cell(raw, idx.horseName),
    units: parseUnits(cell(raw, idx.units)),
    status: cell(raw, idx.status),
    remark: cell(raw, idx.remark),
    fullName: cell(raw, idx.fullName),
    fullNameKana: cell(raw, idx.fullNameKana),
    rank: cell(raw, idx.rank),
    email: normaliseEmail(cell(raw, idx.email)),
    phone: cell(raw, idx.phone),
    postalCode: cell(raw, idx.postalCode),
    address: cell(raw, idx.address),
    stripeCustomerId: cell(raw, idx.stripeCustomerId),
  }));
  return { rows, headerWarnings };
}

/**
 * Group raw rows into customer payloads keyed by email.  Rows with no email
 * cannot be deduplicated reliably and are returned in `dropped` so the UI
 * can surface them.
 */
export function groupByCustomer(rows: LegacyRow[]): {
  customers: LegacyCustomer[];
  dropped: { row: LegacyRow; reason: string }[];
} {
  const dropped: { row: LegacyRow; reason: string }[] = [];
  const byEmail = new Map<string, LegacyRow[]>();
  for (const r of rows) {
    if (!r.email) {
      dropped.push({ row: r, reason: "メール列が空です" });
      continue;
    }
    if (!r.fullName) {
      // Allow — derived from email local-part — but flag once.
    }
    const list = byEmail.get(r.email) ?? [];
    list.push(r);
    byEmail.set(r.email, list);
  }

  const customers: LegacyCustomer[] = [];
  for (const [email, group] of byEmail.entries()) {
    const primary = group[0];
    const fullName = primary.fullName ?? email.split("@")[0];
    const fullNameKana = group.find((r) => r.fullNameKana)?.fullNameKana ?? null;
    const phone = group.find((r) => r.phone)?.phone ?? null;
    const postalCode = group.find((r) => r.postalCode)?.postalCode ?? null;
    const address = group.find((r) => r.address)?.address ?? null;
    const stripeCustomerId =
      group.find((r) => r.stripeCustomerId)?.stripeCustomerId ?? null;
    const status = pickStatus(group.find((r) => r.status)?.status ?? null);
    const planRow = group.find((r) => r.rank) ?? primary;
    const plan = rankToPlan(planRow.rank);
    const contractStartedAt =
      group
        .map((r) => r.contractDate)
        .filter((d): d is string => !!d)
        .sort()[0] ?? null;

    const supports: LegacySupport[] = [];
    for (const r of group) {
      if (!r.horseName) continue;
      const units =
        r.units ??
        (/半口/.test(r.rank ?? "") ? 0.5 : /半口/.test(r.remark ?? "") ? 0.5 : 1);
      supports.push({
        rowNumber: r.rowNumber,
        horseName: r.horseName,
        units,
        contractDate: r.contractDate ?? contractStartedAt,
      });
    }

    customers.push({
      email,
      fullName,
      fullNameKana,
      phone,
      postalCode,
      address,
      status,
      stripeCustomerId,
      plan,
      contractStartedAt,
      supports,
      sourceRows: group.map((r) => r.rowNumber),
    });
  }
  return { customers, dropped };
}
