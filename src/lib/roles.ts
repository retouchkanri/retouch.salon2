/**
 * Role & permission model.
 *
 * Permission levels (highest → lowest authority):
 *   owner > admin > moderator > member
 *
 * - owner / admin / moderator are staff: they reach the admin area (the
 *   capability matrix below decides what each may actually do).
 * - member is the single customer-facing permission level. Legacy values
 *   ("honorary_member" / "user" / "staff") normalise via {@link toRole}.
 *
 * Badges:
 *   - Staff wear crown badges by rank — owner ×3, admin ×2, moderator ×1.
 *   - Members earn a medal by tenure & payment (see {@link memberMedal}):
 *       bronze : registered ≥ 2 months
 *       silver : paying ≥ 6 months (since first successful payment)
 *       gold   : paying ≥ 6 months AND total paid ≥ ¥100,000
 *     No badge is shown on initial registration. An active RPT
 *     (RetouchPony【リタポ】) contract always grants gold.
 */

export const ROLES = ["owner", "admin", "moderator", "member"] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Normalise any stored/legacy value to a valid Role. The former member tiers
 * ("honorary_member", "user") collapse into the single "member" permission;
 * legacy "staff" maps to "moderator"; anything unknown defaults to "member".
 */
export function toRole(value: unknown): Role {
  if (value === "owner" || value === "admin" || value === "moderator" || value === "member") {
    return value;
  }
  if (value === "staff") return "moderator";
  return "member";
}

export const ROLE_LABELS_JP: Record<Role, string> = {
  owner: "オーナー",
  admin: "管理者",
  moderator: "モデレーター",
  member: "会員",
};

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------
// Each capability is a discrete action gate. Routes/pages call can(role, cap)
// (server-side) to decide access. The admin area is reachable by any role with
// "admin.access"; everything else is checked per-action.

export type Capability =
  | "admin.access" // enter the /admin area at all
  | "settings.system" // system-wide configuration
  | "settings.payment" // Stripe / payment configuration
  | "roles.manage" // edit role definitions / promote to owner
  | "users.manageStaff" // create/edit owner & admin accounts (owner only)
  | "users.manage" // manage moderator / member accounts
  | "customers.manage" // create/edit/suspend/withdraw customers
  | "plans.manage" // membership plans & prices
  | "contracts.manage" // contracts / subscriptions
  | "horses.manage" // horses & support availability
  | "supports.manage" // support subscriptions
  | "donations.manage" // donations (write)
  | "payments.manage" // operational payment records
  | "csv" // CSV import / export
  | "audit.view" // view audit logs
  | "events.manage" // events
  | "bookings.manage" // event bookings
  | "news.manage" // news / posts
  | "messages.manage" // 会員向けメッセージ配信（お知らせ・メルマガ）
  | "chatbot.manage" // AIチャットボット設定・ナレッジ管理
  | "backups.manage" // DBバックアップ（実行・自動設定・ダウンロード・削除）
  | "community.manage" // 会員コミュニティ（チャンネル・ユーザー・通報・一括送信の管理）
  | "inquiries.manage"; // inquiries

const ADMIN_CAPS: Capability[] = [
  "admin.access",
  "users.manage",
  "customers.manage",
  "plans.manage",
  "contracts.manage",
  "horses.manage",
  "supports.manage",
  "donations.manage",
  "payments.manage",
  "csv",
  "audit.view",
  "events.manage",
  "bookings.manage",
  "news.manage",
  "messages.manage",
  "chatbot.manage",
  "backups.manage",
  "community.manage",
  "inquiries.manage",
];

const OWNER_CAPS: Capability[] = [
  ...ADMIN_CAPS,
  "settings.system",
  "settings.payment",
  "roles.manage",
  "users.manageStaff",
];

const MODERATOR_CAPS: Capability[] = [
  "admin.access",
  "events.manage",
  "bookings.manage",
  "news.manage",
  "messages.manage",
  "community.manage",
  "inquiries.manage",
];

export const ROLE_CAPABILITIES: Record<Role, Capability[]> = {
  owner: OWNER_CAPS,
  admin: ADMIN_CAPS,
  moderator: MODERATOR_CAPS,
  member: [],
};

export function can(role: Role, capability: Capability): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

/** Roles that can reach the admin dashboard. */
export function isStaffRole(role: Role): boolean {
  return can(role, "admin.access");
}

// ---------------------------------------------------------------------------
// Who may assign / edit whom (user-management page)
// ---------------------------------------------------------------------------
// - owner: may assign any role and edit any account.
// - admin: may manage moderator / member, but NOT owner or admin accounts.

export function assignableRoles(actor: Role): Role[] {
  if (actor === "owner") return [...ROLES];
  if (actor === "admin") return ["moderator", "member"];
  return [];
}

/** Whether `actor` may create/edit/delete an account that currently has role `target`. */
export function canManageRole(actor: Role, target: Role): boolean {
  if (actor === "owner") return true;
  if (actor === "admin") return assignableRoles("admin").includes(target);
  return false;
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type Medal = "gold" | "silver" | "bronze";

/**
 * Resolved badge:
 *  - staff → crown ("full") by rank.
 *  - member → "medal" (gold/silver/bronze) or "none" (just registered).
 */
export type Badge =
  | { kind: "full"; count: 1 | 2 | 3 }
  | { kind: "medal"; tier: Medal }
  | { kind: "none" };

export const MEDAL_LABELS_JP: Record<Medal, string> = {
  gold: "ゴールド",
  silver: "シルバー",
  bronze: "ブロンズ",
};

/** Crown badge for staff roles; null for members. */
export function staffBadge(role: Role): Extract<Badge, { kind: "full" }> | null {
  if (role === "owner") return { kind: "full", count: 3 };
  if (role === "admin") return { kind: "full", count: 2 };
  if (role === "moderator") return { kind: "full", count: 1 };
  return null;
}

// Member medal thresholds.
export const BRONZE_MIN_MONTHS = 2;
export const SILVER_MIN_MONTHS = 6;
export const GOLD_MIN_YEN = 100_000;

export type MemberBadgeStats = {
  /** Customer registration timestamp (ISO), e.g. customers.joined_at. */
  registeredAt: string | null;
  /** Earliest successful payment timestamp (ISO), or null if never paid. */
  firstPaymentAt: string | null;
  /** Sum of all succeeded payments (yen). */
  totalPaidYen: number;
  /** Active RPT (RetouchPony【リタポ】) contract → always gold. */
  hasActiveRpt?: boolean;
};

/** Whole calendar months elapsed from an ISO timestamp to `now` (−1 if invalid/null). */
function monthsElapsed(fromIso: string | null, now: Date): number {
  if (!fromIso) return -1;
  const from = new Date(fromIso);
  if (Number.isNaN(from.getTime())) return -1;
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months -= 1;
  return months;
}

/**
 * Member medal by tenure & payment. Returns null when no badge applies
 * (e.g. just registered). Highest tier wins; an active RPT forces gold.
 */
export function memberMedal(stats: MemberBadgeStats, now: Date = new Date()): Medal | null {
  if (stats.hasActiveRpt) return "gold";
  const payMonths = monthsElapsed(stats.firstPaymentAt, now);
  if (payMonths >= SILVER_MIN_MONTHS) {
    return stats.totalPaidYen >= GOLD_MIN_YEN ? "gold" : "silver";
  }
  if (monthsElapsed(stats.registeredAt, now) >= BRONZE_MIN_MONTHS) return "bronze";
  return null;
}

/** Resolve the full badge for a user: crown (staff) or medal/none (member). */
export function resolveBadge(role: Role, stats: MemberBadgeStats, now: Date = new Date()): Badge {
  const crown = staffBadge(role);
  if (crown) return crown;
  const medal = memberMedal(stats, now);
  return medal ? { kind: "medal", tier: medal } : { kind: "none" };
}

/**
 * A short Japanese hint toward the next medal tier for a member, or null when
 * already at the top (gold / RPT) or when no meaningful progress applies.
 *   none   → ブロンズ (登録2か月)
 *   bronze → シルバー (支払い6か月)
 *   silver → ゴールド (累計¥100,000)
 */
export function nextBadgeHint(stats: MemberBadgeStats, now: Date = new Date()): string | null {
  if (stats.hasActiveRpt) return null; // already gold via RPT
  const medal = memberMedal(stats, now);
  if (medal === "gold") return null;

  if (medal === "silver") {
    const remainingYen = GOLD_MIN_YEN - stats.totalPaidYen;
    return remainingYen > 0
      ? `あと¥${remainingYen.toLocaleString("ja-JP")}のお支払いでゴールド`
      : null;
  }

  if (medal === "bronze") {
    const payMonths = monthsElapsed(stats.firstPaymentAt, now);
    if (payMonths < 0) return "お支払い開始から6か月でシルバー";
    const monthsLeft = SILVER_MIN_MONTHS - payMonths;
    return monthsLeft > 0 ? `あと${monthsLeft}か月の継続でシルバー` : null;
  }

  // medal === null (まだバッジなし) → 次はブロンズ
  const regMonths = monthsElapsed(stats.registeredAt, now);
  if (regMonths < 0) return null;
  const monthsLeft = BRONZE_MIN_MONTHS - regMonths;
  return monthsLeft > 0 ? `あと${monthsLeft}か月でブロンズ` : null;
}
