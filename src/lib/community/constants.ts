/**
 * 会員専用コミュニティ（Slack 風チャット）の共通定数。
 * DB 側の制約（supabase/community.sql の check 制約）と値を一致させること。
 */

export const COMMUNITY_BUCKET = "community";

/** 1メッセージの最大文字数（community_send と同じ）。 */
export const MESSAGE_MAX_LENGTH = 4000;
/** 添付の最大サイズ（バケットの file_size_limit と同じ 10MB）。 */
export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_COUNT = 10;
/** バケットの allowed_mime_types と同じ。 */
export const ATTACHMENT_ALLOWED_TYPES: readonly string[] = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
export const ATTACHMENT_ACCEPT = ATTACHMENT_ALLOWED_TYPES.join(",");

export const DISPLAY_NAME_MAX = 40;
export const BIO_MAX = 300;
export const CHANNEL_NAME_MAX = 60;
export const CHANNEL_DESCRIPTION_MAX = 500;
export const CHANNEL_TOPIC_MAX = 200;

export const CATEGORIES = [
  "general",
  "announcement",
  "event",
  "horse",
  "supporters",
  "rank",
  "staff",
  "other",
] as const;
export type ChannelCategory = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ChannelCategory, string> = {
  general: "一般",
  announcement: "お知らせ",
  event: "イベント",
  horse: "馬の近況",
  supporters: "支援者",
  rank: "会員ランク",
  staff: "運営",
  other: "その他",
};

export const CATEGORY_ICONS: Record<ChannelCategory, string> = {
  general: "💬",
  announcement: "📣",
  event: "📅",
  horse: "🐴",
  supporters: "🤝",
  rank: "🏅",
  staff: "🛠️",
  other: "📁",
};

export const AUDIENCES = ["all", "plans", "supporters", "staff"] as const;
export type ChannelAudience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<ChannelAudience, string> = {
  all: "全会員（コミュニティを利用できる有料会員）",
  plans: "会員種別（ランク）指定",
  supporters: "支援者（馬を指定）",
  staff: "運営のみ",
};

/**
 * 会員種別（ランク）コード。community__member_codes が返す値と一致させる。
 * A はアテンダー会員（¥0）を含む「メンバーズ会員」の区分。
 */
export const MEMBER_CODES = ["A", "B", "C", "OWNER", "SUPPORT", "RPT", "SPECIAL_TEAM", "FREE"] as const;
export type MemberCode = (typeof MEMBER_CODES)[number];

export const MEMBER_CODE_LABELS: Record<MemberCode, string> = {
  A: "メンバーズ会員",
  B: "サポーター会員",
  C: "リェリーフ会員",
  OWNER: "オーナーズ会員",
  SUPPORT: "ヘルパーズ会員（一口支援）",
  RPT: "リタポメンバー",
  SPECIAL_TEAM: "特別チーム会員",
  FREE: "無料会員（会員種別なし）",
};

/** チャンネルの対象者を日本語で説明する（管理画面・一覧表示用）。 */
export function describeAudience(
  ch: {
    visibility: "public" | "private";
    audience: ChannelAudience;
    audience_plan_codes: string[];
    audience_horse_ids: string[];
  },
  horseName: (id: string) => string | undefined = () => undefined,
): string {
  if (ch.visibility === "private") return "非公開（招待したメンバーのみ）";
  switch (ch.audience) {
    case "all":
      return "コミュニティを利用できる会員全員";
    case "staff":
      return "運営のみ";
    case "plans":
      return `会員種別: ${ch.audience_plan_codes.map((c) => MEMBER_CODE_LABELS[c as MemberCode] ?? c).join("・") || "（未指定）"}`;
    case "supporters":
      return ch.audience_horse_ids.length === 0
        ? "支援者: いずれかの馬を支援中の会員"
        : `支援者: ${ch.audience_horse_ids.map((id) => horseName(id) ?? "（削除された馬）").join("・")}`;
    default:
      return "";
  }
}

/**
 * 管理画面でチャンネルを分けて表示するグループ（上から順に表示する）。
 *   public: 全会員に表示する公開チャンネル / member: 会員種別ごとのチャンネル /
 *   staff: 運営だけのチャンネル / horse: 支援馬ごとのチャンネル /
 *   other: どれにも当てはまらないもの（招待制のチャンネルなど。あるときだけ表示する）
 */
export const CHANNEL_GROUPS = [
  { key: "public", label: "公開チャンネル", note: "コミュニティを利用できる会員（有料会員）全員に表示するチャンネルです。" },
  { key: "member", label: "会員チャンネル", note: "その会員種別の方だけに表示されます（ほかの会員には表示されません）。" },
  { key: "staff", label: "運営チャンネル", note: "運営だけに表示されます（会員には表示されません）。" },
  { key: "horse", label: "支援馬のチャンネル", note: "その馬を支援している方だけに表示されます（ほかの会員には表示されません）。" },
  { key: "other", label: "その他のチャンネル", note: "運営が追加したメンバーだけに表示するチャンネルです。" },
] as const;
export type ChannelGroupKey = (typeof CHANNEL_GROUPS)[number]["key"];

/**
 * チャンネルがどのグループか。分類（category）と対象者（audience）で決める。
 * 分類が「一般」「お知らせ」のチャンネルは、公開・非公開や非表示の設定を変えても公開チャンネルのグループに
 * 置いたままにする（設定を切り替えるたびに別のグループへ動かないようにするため。状態は行ごとに表示する）。
 */
export function channelGroupOf(ch: {
  category: string;
  visibility: "public" | "private";
  audience: string;
}): ChannelGroupKey {
  if (ch.category === "staff" || ch.audience === "staff") return "staff";
  if (ch.category === "supporters" || ch.audience === "supporters") return "horse";
  if (ch.category === "rank" || ch.audience === "plans") return "member";
  if (ch.category === "general" || ch.category === "announcement") return "public";
  if (ch.visibility === "public" && ch.audience === "all") return "public";
  return "other";
}

/** 「会員専用（有料会員種別をお持ちの方）」のプリセット。 */
export const PAID_MEMBER_CODES: readonly MemberCode[] = MEMBER_CODES.filter((c) => c !== "FREE");

export const NOTIFY_LEVELS = ["all", "mentions", "none"] as const;
export type NotifyLevel = (typeof NOTIFY_LEVELS)[number];

export const NOTIFY_LABELS: Record<NotifyLevel, string> = {
  all: "すべての新着メッセージ",
  mentions: "@メンションのみ",
  none: "通知しない（ミュート）",
};

/** メッセージにカーソルを合わせたときのクイックリアクション（Slack の既定と同じ） */
export const QUICK_REACTIONS = ["✅", "👀", "🙌"] as const;

/** 絵文字ピッカー */
export const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "よく使う",
    emojis: ["👍", "❤️", "😂", "🎉", "🙏", "👏", "😊", "😍", "🥰", "😢", "😮", "🔥", "✨", "💯", "✅", "👀"],
  },
  {
    label: "表情",
    emojis: ["😀", "😃", "😄", "😁", "😆", "🤣", "🙂", "😉", "😌", "😋", "🤗", "🤔", "😅", "😭", "😤", "😱", "🥺", "😴", "🤩", "😎"],
  },
  {
    label: "ジェスチャー",
    emojis: ["👋", "🙌", "👌", "✌️", "🤝", "💪", "🙇", "🙆", "🙅", "💁", "☝️", "👉"],
  },
  {
    label: "動物・自然",
    emojis: ["🐴", "🐎", "🏇", "🦄", "🥕", "🍎", "🌾", "🍀", "🌸", "🌻", "🌈", "☀️", "🌙", "⭐", "🐶", "🐱"],
  },
  {
    label: "記号",
    emojis: ["💚", "💛", "🧡", "💙", "💜", "🤍", "💐", "🎁", "📣", "📅", "📷", "📝", "❗", "❓", "⭕", "❌"],
  },
  {
    label: "その他",
    emojis: ["💡", "🚀", "👑", "🏆", "☕", "🍰", "📌", "🔔", "💬", "🙆‍♀️"],
  },
];
