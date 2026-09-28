import type { ChannelAudience, ChannelCategory, NotifyLevel } from "./constants";

/** community_list_channels() の1行。 */
export type ChannelRow = {
  id: string;
  kind: "channel" | "dm";
  name: string | null;
  description: string | null;
  topic: string | null;
  category: ChannelCategory;
  visibility: "public" | "private";
  audience: ChannelAudience;
  audience_plan_codes: string[];
  audience_horse_ids: string[];
  post_policy: "everyone" | "staff";
  auto_join: boolean;
  is_required: boolean;
  sort_order: number;
  is_archived: boolean;
  created_at: string;
  joined: boolean;
  notify: NotifyLevel | null;
  is_starred: boolean;
  last_read_at: string | null;
  unread_count: number;
  mention_count: number;
  last_message_at: string | null;
  dm_user_id: string | null;
  can_post: boolean;
  /** チャンネルを作成したユーザー（初期チャンネル・管理画面で作成したものは null のことがある）。 */
  created_by: string | null;
  /** 名前の変更・アーカイブ・ピン留め・非公開チャンネルのメンバー削除ができるか（作成者と運営）。 */
  can_manage: boolean;
  /** DM の最新メッセージの冒頭（DM 一覧の表示用。チャンネルは null）。 */
  last_message_preview: string | null;
  last_message_user_id: string | null;
  /** メンバー数（Slack と同じく参加している人数。自動参加のチャンネルは参加資格のある全員）。 */
  member_count: number;
  /** アイコン（画像のパス /uploads/... または絵文字1つ。null = # / 鍵のマーク）。 */
  icon?: string | null;
};

export type Attachment = {
  path: string;
  name: string;
  type: string;
  size: number | null;
};

/** community_messages の1行。 */
export type Message = {
  id: string;
  channel_id: string;
  user_id: string | null;
  parent_id: string | null;
  body: string;
  attachments: Attachment[];
  mentions: string[];
  mention_channel: boolean;
  reactions: Record<string, string[]>;
  reply_count: number;
  last_reply_at: string | null;
  last_reply_user_id: string | null;
  reply_user_ids: string[];
  is_pinned: boolean;
  pinned_by: string | null;
  pinned_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  created_at: string;
};

export type CommunityProfile = {
  user_id: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  is_staff: boolean;
  allow_dm: boolean;
  setup_done: boolean;
  last_seen_at: string | null;
  /** アクティビティを最後に確認した日時。 */
  activity_seen_at?: string | null;
  created_at: string;
  updated_at: string;
};

/** community_bootstrap() の戻り値。 */
export type Bootstrap = {
  authenticated: boolean;
  user_id?: string;
  is_staff?: boolean;
  /** 互換用（常に true。公開操作は廃止）。 */
  is_open?: boolean;
  is_active?: boolean;
  is_member?: boolean;
  ban?: { reason: string | null; until: string | null } | null;
  profile?: CommunityProfile | null;
};

/** community_user_info() / community_directory() の1行。 */
export type UserInfo = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  bio?: string | null;
  is_staff: boolean;
  real_name: string | null;
  username?: string | null;
};

export type UnreadSummary = {
  badge: number;
  has_unread: boolean;
  dm_unread: number;
  /** 他の人から届いた未読メッセージの合計（ミュートは除く）。データベース更新前は badge と同じ値。 */
  unread_total: number;
};

/** community_history() の戻り値（古い順）。 */
export type HistoryPage = {
  messages: Message[];
  has_more: boolean;
  users: UserInfo[];
};

/** community_thread() の戻り値。 */
export type ThreadPage = {
  parent: Message;
  replies: Message[];
  users: UserInfo[];
};

/** community_init() の戻り値（利用できない場合は Bootstrap の項目のみ）。 */
export type InitPayload = Bootstrap & {
  channels?: ChannelRow[];
  channel_id?: string | null;
  history?: HistoryPage | null;
  users?: UserInfo[];
};

/** community_channel_member_list() の戻り値。 */
export type MemberList = { total: number; users: UserInfo[] };

export type ActivityReason = "mention" | "channel" | "reply";
export type ActivityItem = { reason: ActivityReason; message: Message };
/** community_activity() の戻り値。 */
export type ActivityFeed = { items: ActivityItem[]; seen_at: string | null; users: UserInfo[] };

export type SearchHit = {
  id: string;
  channel_id: string;
  parent_id: string | null;
  user_id: string | null;
  body: string;
  created_at: string;
};
