import type { Capability } from "@/lib/roles";

/**
 * Admin sidebar menu. Each item shows an emoji rendered from the Fluent Emoji
 * 3D set (MIT, © Microsoft) self-hosted under /public/noprecache/emoji as 64px PNGs
 * named by codepoint — e.g. 📊 → /noprecache/emoji/1f4ca.png (see src/lib/emoji.ts).
 *
 * To use a new emoji: download it from github.com/microsoft/fluentui-emoji
 * (assets/<Name>/3D/*.png), resize to 64×64, save it as /public/noprecache/emoji/<codepoint>.png
 * and add the codepoint to EMOJI_IMAGE_CODES in src/lib/emoji.ts.
 * tests/adminNavItems.test.ts fails if a file is missing.
 */
export type NavItem = {
  href: string;
  label: string;
  emoji: string;
  cap?: Capability;
  external?: boolean;
  /** 新しく足したメニュー。絵文字を揺らして知らせる。 */
  fresh?: boolean;
};

export type NavGroup = { id: string; label: string; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    id: "overview",
    label: "全体",
    items: [
      { href: "/admin", label: "ダッシュボード", emoji: "📊" },
      { href: "/admin/reports", label: "経営管理", emoji: "📅", cap: "payments.manage", fresh: true },
      { href: "/admin/giving", label: "寄付状況", emoji: "✨", cap: "payments.manage", fresh: true },
      { href: "/admin/search", label: "横断検索", emoji: "🔍" },
      { href: "/admin/audit-logs", label: "監査ログ", emoji: "🛡️", cap: "audit.view" },
    ],
  },
  {
    id: "members",
    label: "会員・支援",
    items: [
      { href: "/admin/customers", label: "顧客一覧", emoji: "📇" },
      { href: "/admin/contracts", label: "契約一覧", emoji: "📝", cap: "contracts.manage" },
      { href: "/admin/supports", label: "支援管理", emoji: "💝" },
      { href: "/admin/donations", label: "寄付一覧", emoji: "🎁" },
      { href: "/admin/payments", label: "決済履歴", emoji: "💳", cap: "payments.manage" },
      { href: "/admin/follow-ups", label: "要フォロー", emoji: "❗", cap: "payments.manage", fresh: true },
    ],
  },
  {
    id: "master",
    label: "マスタ",
    items: [
      { href: "/admin/plans", label: "会員プラン", emoji: "👑", cap: "plans.manage" },
      { href: "/guide", label: "入会案内（公開）", emoji: "📖", external: true },
      { href: "/support-guide", label: "1口支援案内（公開）", emoji: "🌱", external: true },
      { href: "/admin/horses", label: "馬マスタ", emoji: "🐴" },
      { href: "/admin/horse-reports", label: "馬の報告", emoji: "⭐", fresh: true },
      { href: "/admin/events", label: "イベントマスタ", emoji: "🎉" },
      { href: "/admin/bookings", label: "予約管理", emoji: "🗓️" },
      { href: "/admin/horse-meetings", label: "馬の面会", emoji: "🥕" },
      { href: "/admin/news", label: "ニュース", emoji: "📰" },
      { href: "/admin/member-messages", label: "メッセージ配信", emoji: "📣", cap: "messages.manage" },
      { href: "/admin/community", label: "コミュニティ管理", emoji: "💬", cap: "community.manage" },
      { href: "/admin/chatbot", label: "AIチャットボット", emoji: "🤖", cap: "chatbot.manage" },
    ],
  },
  {
    id: "ops",
    label: "運用",
    items: [
      { href: "/admin/users", label: "ユーザー管理", emoji: "🔐", cap: "users.manage" },
      { href: "/admin/csv", label: "CSV 入出力", emoji: "🗂️", cap: "csv" },
      { href: "/admin/backups", label: "DBバックアップ", emoji: "💾", cap: "backups.manage" },
      { href: "/admin/profile", label: "マイプロフィール", emoji: "🪪" },
    ],
  },
];

export { emojiCode, emojiSrc } from "@/lib/emoji";
