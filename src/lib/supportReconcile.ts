/**
 * サイトに登録されている一口支援（支援管理）と、Stripe が課金している一口支援の照合（I/O なし）。
 * 支援者ごとに口数を比べ、合わない人を一覧にする。管理者だけが見る（会員向けの報告には入れない）。
 */

/** サイトの登録。状態が「有効」の支援の行だけを渡す。 */
export type SiteSupportRow = { customer_id: string; units: number | string | null };

/** Stripe で一口支援を払っている人。同じメールアドレスの Stripe 顧客は 1 人にまとめてある。 */
export type StripeSupportPayer = {
  email: string | null;
  stripeCustomerIds: string[];
  /** 支払い中（active / trialing）の口数。 */
  units: number;
  /** 支払いが遅れている（past_due）口数。units には含めない。 */
  pastDueUnits: number;
};

export type ReconcileCustomer = { id: string; full_name: string | null; email: string | null; stripe_customer_id: string | null };

export type SupportMismatchKind = "site_only" | "site_more" | "stripe_more" | "stripe_only";

export const SUPPORT_MISMATCH_LABEL: Record<SupportMismatchKind, string> = {
  site_only: "サイトにだけある（Stripe の課金なし）",
  site_more: "サイトの口数のほうが多い",
  stripe_more: "Stripe の口数のほうが多い",
  stripe_only: "Stripe にだけある（サイトに有効な登録なし）",
};

export type SupportMismatch = {
  kind: SupportMismatchKind;
  /** サイトの顧客。Stripe にだけいて、サイトの顧客に結び付かないときは null。 */
  customerId: string | null;
  name: string;
  email: string | null;
  siteUnits: number;
  stripeUnits: number;
  pastDueUnits: number;
};

export type SupportReconciliation = {
  /** サイトの登録（支援管理と同じ数字）。 */
  site: { supporters: number; units: number };
  /** Stripe で支払い中の定期課金。 */
  stripe: { supporters: number; units: number };
  /** サイトの登録のうち、Stripe が課金している分（人ごとに、登録と課金の少ないほう）。 */
  billedUnits: number;
  /** サイトの登録のうち、Stripe の課金がない分（銀行振込・手動登録、Stripe では終了している支援など）。 */
  unbilledUnits: number;
  mismatches: SupportMismatch[];
};

const KIND_ORDER: SupportMismatchKind[] = ["stripe_only", "stripe_more", "site_more", "site_only"];

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function reconcileSupport(
  siteRows: SiteSupportRow[],
  payers: StripeSupportPayer[],
  customers: ReconcileCustomer[],
): SupportReconciliation {
  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const idByStripeCustomer = new Map<string, string>();
  const idByEmail = new Map<string, string>();
  for (const customer of customers) {
    if (customer.stripe_customer_id) idByStripeCustomer.set(customer.stripe_customer_id, customer.id);
    const email = normalizeEmail(customer.email);
    if (email) idByEmail.set(email, customer.id);
  }

  type Person = { customerId: string | null; email: string | null; site: number; stripe: number; pastDue: number };
  const people = new Map<string, Person>();
  const person = (key: string, customerId: string | null, email: string | null): Person => {
    const found = people.get(key);
    if (found) return found;
    const created: Person = { customerId, email, site: 0, stripe: 0, pastDue: 0 };
    people.set(key, created);
    return created;
  };

  for (const row of siteRows) {
    person(row.customer_id, row.customer_id, customerById.get(row.customer_id)?.email ?? null).site += Number(row.units) || 0;
  }
  for (const payer of payers) {
    // Stripe の顧客IDで結び付け、無ければメールアドレスで結び付ける。どちらも合わなければ、サイトの顧客ではない人として扱う。
    const customerId =
      payer.stripeCustomerIds.map((id) => idByStripeCustomer.get(id)).find((id): id is string => !!id) ??
      idByEmail.get(normalizeEmail(payer.email)) ??
      null;
    const key = customerId ?? `stripe:${normalizeEmail(payer.email) || payer.stripeCustomerIds[0] || ""}`;
    const target = person(key, customerId, customerId ? customerById.get(customerId)?.email ?? payer.email : payer.email);
    target.stripe += payer.units;
    target.pastDue += payer.pastDueUnits;
  }

  let siteUnits = 0;
  let siteSupporters = 0;
  let stripeUnits = 0;
  let stripeSupporters = 0;
  let billedUnits = 0;
  const mismatches: SupportMismatch[] = [];
  for (const entry of people.values()) {
    siteUnits += entry.site;
    stripeUnits += entry.stripe;
    if (entry.site > 0) siteSupporters += 1;
    if (entry.stripe > 0) stripeSupporters += 1;
    billedUnits += Math.min(entry.site, entry.stripe);
    if (entry.site === entry.stripe) continue;
    const kind: SupportMismatchKind =
      entry.stripe === 0 ? "site_only" : entry.site === 0 ? "stripe_only" : entry.site > entry.stripe ? "site_more" : "stripe_more";
    const customer = entry.customerId ? customerById.get(entry.customerId) : undefined;
    mismatches.push({
      kind,
      customerId: entry.customerId,
      name: customer?.full_name?.trim() || (entry.customerId ? "（氏名なし）" : "（サイトに顧客なし）"),
      email: entry.email,
      siteUnits: entry.site,
      stripeUnits: entry.stripe,
      pastDueUnits: entry.pastDue,
    });
  }
  mismatches.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      Math.abs(b.siteUnits - b.stripeUnits) - Math.abs(a.siteUnits - a.stripeUnits) ||
      a.name.localeCompare(b.name, "ja"),
  );

  return {
    site: { supporters: siteSupporters, units: siteUnits },
    stripe: { supporters: stripeSupporters, units: stripeUnits },
    billedUnits,
    unbilledUnits: siteUnits - billedUnits,
    mismatches,
  };
}
