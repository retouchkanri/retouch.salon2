/**
 * 継続支援が途切れる前の「要フォロー」。退会済みの人は含めない。
 */

export const LOGIN_STALE_DAYS = 90;
export const FAILED_WINDOW_DAYS = 45;
export const STOP_WINDOW_DAYS = 60;
/**
 * 「済」「削除」の印をつけてから、この日数のあいだの決済失敗は、同じ件として扱う。
 * カード会社への再請求が数日おきに続くため（2026-10 実測：同じ人の失敗の間隔は、ほとんどが 7日以内）。
 */
export const MARK_RETRY_DAYS = 30;

export const FOLLOW_REASONS = [
  { key: "payment_failed", label: "決済失敗" },
  { key: "payment_update", label: "支払い更新が必要" },
  { key: "inactive_login", label: "長期間ログインしていない" },
  { key: "plan_stopped", label: "支援プランを停止した" },
  { key: "usage_down", label: "最近利用が減っている" },
] as const;

export type FollowReason = (typeof FOLLOW_REASONS)[number]["key"];

export type FollowCustomer = {
  id: string;
  name: string;
  email: string | null;
  status: string;
  authUserId: string | null;
  joinedAt: string | null;
};

export type FollowContract = {
  customerId: string;
  status: string;
  canceledAt: string | null;
};

export type FollowSupport = {
  customerId: string;
  monthlyAmount: number;
  status: string;
  startedAt: string;
  canceledAt: string | null;
};

export type FollowPayment = {
  customerId: string | null;
  status: string;
  occurredAt: string;
  failureReason: string | null;
};

export type FollowUp = {
  customerId: string;
  name: string;
  email: string | null;
  reasons: FollowReason[];
  monthlyYen: number;
  annualYen: number;
  detail: string;
  /** 直近の決済失敗の日時（集計の期間内）。無いときは null。 */
  latestFailedAt: string | null;
  /** 直近の支援・契約の停止の日時（集計の期間内）。無いときは null。 */
  latestStopAt: string | null;
};

/** 管理者がつける印。済 = 連絡などの対応が済んだ。削除 = 一覧から外す。 */
export const FOLLOW_MARK_STATES = [
  { key: "done", label: "済" },
  { key: "dismissed", label: "削除" },
] as const;
export type FollowMarkState = (typeof FOLLOW_MARK_STATES)[number]["key"];

export type FollowMark = {
  customerId: string;
  state: FollowMarkState;
  /** 印をつけた日時。 */
  at: string;
  /** 印をつけたときに出ていた理由。 */
  reasons: FollowReason[];
};

/** 印の記録（つけた・外したの履歴）。いちばん新しい 1件が、その人のいまの印。 */
export type FollowMarkEvent = {
  customerId: string | null;
  state: string;
  at: string;
  reasons?: unknown;
};

export type FollowStatus = "open" | FollowMarkState;

const DAY = 24 * 60 * 60 * 1000;

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
}

function activeAmount(supports: FollowSupport[], at: number): number {
  let sum = 0;
  for (const support of supports) {
    if (support.status === "incomplete" || support.status === "canceled") {
      const canceled = time(support.canceledAt);
      if (support.status === "canceled" && canceled == null) continue;
    }
    const started = time(support.startedAt);
    if (started == null || started > at) continue;
    const canceled = time(support.canceledAt);
    if (canceled != null && canceled <= at) continue;
    if (support.status === "incomplete") continue;
    sum += Number(support.monthlyAmount) || 0;
  }
  return sum;
}

function recentlyCanceledAmount(supports: FollowSupport[], now: number, since: number): number {
  let sum = 0;
  for (const support of supports) {
    const canceled = time(support.canceledAt);
    if (canceled != null && canceled >= since && canceled <= now) sum += Number(support.monthlyAmount) || 0;
  }
  return sum;
}

export function buildFollowUps(
  input: {
    customers: FollowCustomer[];
    contracts: FollowContract[];
    supports: FollowSupport[];
    payments: FollowPayment[];
    logins: { authUserId: string; lastSignInAt: string | null }[];
    hiddenEmails?: readonly string[];
  },
  now = new Date(),
): FollowUp[] {
  const nowMs = now.getTime();
  const failedSince = nowMs - FAILED_WINDOW_DAYS * DAY;
  const stopSince = nowMs - STOP_WINDOW_DAYS * DAY;
  const loginSince = nowMs - LOGIN_STALE_DAYS * DAY;
  const hidden = new Set((input.hiddenEmails ?? []).map((email) => email.trim().toLowerCase()));
  const logins = new Map(input.logins.map((row) => [row.authUserId, row.lastSignInAt]));
  const contracts = new Map<string, FollowContract[]>();
  for (const contract of input.contracts) {
    const list = contracts.get(contract.customerId) ?? [];
    list.push(contract);
    contracts.set(contract.customerId, list);
  }
  const supports = new Map<string, FollowSupport[]>();
  for (const support of input.supports) {
    const list = supports.get(support.customerId) ?? [];
    list.push(support);
    supports.set(support.customerId, list);
  }
  const failed = new Map<string, FollowPayment[]>();
  for (const payment of input.payments) {
    if (!payment.customerId || payment.status !== "failed") continue;
    const at = time(payment.occurredAt);
    if (at == null || at < failedSince || at > nowMs) continue;
    const list = failed.get(payment.customerId) ?? [];
    list.push(payment);
    failed.set(payment.customerId, list);
  }

  const rows: FollowUp[] = [];
  for (const customer of input.customers) {
    if (customer.status === "withdrawn") continue;
    if (customer.email && hidden.has(customer.email.trim().toLowerCase())) continue;
    const reasons = new Set<FollowReason>();
    const notes: string[] = [];
    const ownContracts = contracts.get(customer.id) ?? [];
    const ownSupports = supports.get(customer.id) ?? [];
    const ownFailed = failed.get(customer.id) ?? [];
    const pastDue = ownContracts.some((contract) => contract.status === "past_due");
    const incomplete = ownContracts.some((contract) => contract.status === "incomplete");
    const cardProblem = ownFailed.some((payment) => /expir|期限|card|カード/i.test(payment.failureReason ?? ""));

    if (pastDue || ownFailed.length > 0) {
      reasons.add("payment_failed");
      notes.push(pastDue ? "契約が決済失敗の状態です。" : `直近${FAILED_WINDOW_DAYS}日に失敗した決済が${ownFailed.length}件あります。`);
    }
    if (pastDue || incomplete || cardProblem) {
      reasons.add("payment_update");
      notes.push(incomplete ? "支払いの確認が終わっていません。" : "カードの更新か、別の支払い方法が必要です。");
    }

    const currentYen = activeAmount(ownSupports, nowMs);
    const previousYen = activeAmount(ownSupports, stopSince);
    if (currentYen > 0 && previousYen > currentYen) {
      reasons.add("usage_down");
      notes.push(`月額が ${previousYen.toLocaleString("ja-JP")}円から ${currentYen.toLocaleString("ja-JP")}円に減っています。`);
    }

    const stoppedContract = ownContracts.some((contract) => {
      const canceled = time(contract.canceledAt);
      return contract.status === "canceled" && canceled != null && canceled >= stopSince && canceled <= nowMs;
    });
    const stoppedSupport = ownSupports.some((support) => {
      const canceled = time(support.canceledAt);
      return canceled != null && canceled >= stopSince && canceled <= nowMs;
    });
    if (stoppedContract || stoppedSupport) {
      reasons.add("plan_stopped");
      notes.push(`直近${STOP_WINDOW_DAYS}日に支援の停止があります。`);
    }

    const joined = time(customer.joinedAt);
    const hasOngoing = currentYen > 0 || ownContracts.some((contract) => contract.status === "active" || contract.status === "past_due");
    if (customer.authUserId && logins.has(customer.authUserId) && hasOngoing && joined != null && joined <= loginSince) {
      const last = time(logins.get(customer.authUserId));
      if (last == null || last <= loginSince) {
        reasons.add("inactive_login");
        notes.push(`最終ログインから${LOGIN_STALE_DAYS}日以上たっています。`);
      }
    }

    if (reasons.size === 0) continue;
    const latest = (values: (string | null)[]) => {
      let best: string | null = null;
      for (const value of values) {
        const at = time(value);
        if (at != null && (best == null || at > time(best)!)) best = value;
      }
      return best;
    };
    const inStopWindow = (iso: string | null) => {
      const canceled = time(iso);
      return canceled != null && canceled >= stopSince && canceled <= nowMs;
    };
    const canceledYen = recentlyCanceledAmount(ownSupports, nowMs, stopSince);
    const monthlyYen = currentYen > 0 ? currentYen : canceledYen;
    const order = FOLLOW_REASONS.map((reason) => reason.key);
    rows.push({
      customerId: customer.id,
      name: customer.name,
      email: customer.email,
      reasons: order.filter((key) => reasons.has(key)),
      monthlyYen,
      annualYen: monthlyYen * 12,
      detail: notes.join(""),
      latestFailedAt: latest(ownFailed.map((payment) => payment.occurredAt)),
      latestStopAt: latest([
        ...ownContracts.filter((contract) => contract.status === "canceled" && inStopWindow(contract.canceledAt)).map((contract) => contract.canceledAt),
        ...ownSupports.filter((support) => inStopWindow(support.canceledAt)).map((support) => support.canceledAt),
      ]),
    });
  }
  rows.sort((a, b) => b.monthlyYen - a.monthlyYen || a.name.localeCompare(b.name, "ja"));
  return rows;
}

const MARK_KEYS = new Set<string>(FOLLOW_MARK_STATES.map((state) => state.key));

/** 保存する前や読み込んだあとに、理由のキーだけを残す。 */
export function cleanFollowReasons(value: unknown): FollowReason[] {
  if (!Array.isArray(value)) return [];
  return FOLLOW_REASONS.map((reason) => reason.key).filter((key) => value.includes(key));
}

/** 印の履歴から、顧客ごとのいまの印を出す。最後が「未対応に戻す」の人は、印なし。 */
export function latestFollowMarks(events: FollowMarkEvent[]): Map<string, FollowMark> {
  const sorted = [...events].sort((a, b) => (time(a.at) ?? 0) - (time(b.at) ?? 0));
  const marks = new Map<string, FollowMark>();
  for (const event of sorted) {
    if (!event.customerId || time(event.at) == null) continue;
    if (MARK_KEYS.has(event.state)) {
      marks.set(event.customerId, {
        customerId: event.customerId,
        state: event.state as FollowMarkState,
        at: event.at,
        reasons: cleanFollowReasons(event.reasons),
      });
    } else if (event.state === "open") {
      marks.delete(event.customerId);
    }
  }
  return marks;
}

/**
 * いまの状態。印は、つけたときの件についてのもの。次のどれかがあれば、印があっても「未対応」に戻す：
 *   - 印をつけたときには無かった理由が加わった
 *   - 印をつけたあとに、支援や契約の停止があった
 *   - 印をつけてから MARK_RETRY_DAYS 日を過ぎたあとに、決済失敗があった（それまでの失敗は、同じ請求の再請求とみなす）
 * renewed は、印があったのに未対応に戻したとき true。
 */
export function followStatus(row: FollowUp, mark: FollowMark | null | undefined): { status: FollowStatus; renewed: boolean } {
  if (!mark) return { status: "open", renewed: false };
  const markedAt = time(mark.at);
  if (markedAt == null) return { status: "open", renewed: false };
  const newReason = row.reasons.some((reason) => !mark.reasons.includes(reason));
  const stoppedAt = time(row.latestStopAt);
  const failedAt = time(row.latestFailedAt);
  const stoppedAgain = stoppedAt != null && stoppedAt > markedAt;
  const failedAgain = failedAt != null && failedAt >= markedAt + MARK_RETRY_DAYS * DAY;
  if (newReason || stoppedAgain || failedAgain) return { status: "open", renewed: true };
  return { status: mark.state, renewed: false };
}

/** 未対応・済・削除ごとに分ける。 */
export function splitFollowUps(rows: FollowUp[], marks: ReadonlyMap<string, FollowMark>): Record<FollowStatus, FollowUp[]> {
  const out: Record<FollowStatus, FollowUp[]> = { open: [], done: [], dismissed: [] };
  for (const row of rows) out[followStatus(row, marks.get(row.customerId)).status].push(row);
  return out;
}

export function followUpRiskYen(rows: FollowUp[]): { monthly: number; annual: number } {
  const monthly = rows.reduce((sum, row) => sum + row.monthlyYen, 0);
  return { monthly, annual: monthly * 12 };
}
