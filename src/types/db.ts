export type ContractStatus =
  | "active"
  | "past_due"
  | "canceled"
  | "paused"
  | "incomplete";

export type PaymentStatus = "succeeded" | "failed" | "pending" | "refunded" | "canceled";
export type PaymentKind = "subscription" | "donation" | "one_time";
export type EventType = "visit" | "private_visit";
export type BookingStatus = "reserved" | "canceled" | "attended" | "no_show";
export type CustomerStatus = "active" | "suspended" | "withdrawn";
export type MemberPlanCode = "A" | "B" | "C" | "OWNER" | "SPECIAL_TEAM" | "SUPPORT" | "RPT";

export type Customer = {
  id: string;
  auth_user_id: string | null;
  stripe_customer_id: string | null;
  full_name: string;
  full_name_kana: string | null;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  gender: "male" | "female" | "other" | "unspecified" | null;
  postal_code: string | null;
  address1: string | null;
  address2: string | null;
  avatar_url: string | null;
  status: CustomerStatus;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
  // --- 2段階登録（メール確認）で追加した詳細プロフィール項目 ---
  // 既存の full_name / full_name_kana / address1 / address2 はこれらから自動合成して
  // 同期する（後方互換のため）。全て nullable。
  username: string | null;
  last_name: string | null;
  first_name: string | null;
  last_name_kana: string | null;
  first_name_kana: string | null;
  prefecture: string | null;
  address_city: string | null;
  address_town: string | null;
  address_building: string | null;
  /** お知らせ通知の配信停止フラグ（false = 通知する）。 */
  announcement_opt_out: boolean;
  /** メルマガ配信停止フラグ（false = 受信する）。 */
  newsletter_opt_out: boolean;
  /** 本登録（プロフィール入力）完了フラグ。既存会員は true。 */
  registration_completed: boolean;
};

export type MembershipPlan = {
  id: string;
  code: MemberPlanCode;
  name: string;
  monthly_amount: number;
  unit_amount: number | null;
  allow_with_support: boolean;
  allow_with_team: boolean;
  stripe_price_id: string | null;
  description: string | null;
  is_active: boolean;
  sort_order: number;
};

export type Horse = {
  id: string;
  name: string;
  name_kana: string | null;
  sex: string | null;
  birth_year: number | null;
  retired_at: string | null;
  profile: string | null;
  image_url: string | null;
  stripe_price_half_id: string | null;
  stripe_price_full_id: string | null;
  is_supportable: boolean;
  is_emergency_recruitment?: boolean;
  sort_order: number;
};

export type Contract = {
  id: string;
  customer_id: string;
  plan_id: string | null;
  stripe_subscription_id: string | null;
  status: ContractStatus;
  current_period_end: string | null;
  started_at: string;
  canceled_at: string | null;
  plan?: MembershipPlan | null;
};

export type SupportSubscription = {
  id: string;
  contract_id: string;
  customer_id: string;
  horse_id: string;
  units: number;
  monthly_amount: number;
  status: ContractStatus;
  started_at: string;
  canceled_at: string | null;
  horse?: Horse | null;
};

export type DonationPaymentMethod = "card" | "bank_transfer";

export type Donation = {
  id: string;
  customer_id: string | null;
  donor_name: string | null;
  donor_email: string | null;
  amount: number;
  message: string | null;
  status: PaymentStatus;
  /** 支払方法：カード（Stripe）／銀行振込（手動登録）。 */
  payment_method: DonationPaymentMethod;
  /** 入金確認日（銀行振込の着金確認日など）。 */
  confirmed_at: string | null;
  /** 備考（管理用メモ。寄付者の message とは別）。 */
  note: string | null;
  donated_at: string;
};

export type EventRow = {
  id: string;
  type: EventType;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string | null;
  capacity: number;
  location: string | null;
  supporters_only: boolean;
  is_published: boolean;
};

/** 同伴者（見学会の申込項目）。relation: ご家族／ご友人／その他。 */
export type BookingCompanion = {
  name: string;
  relation: "family" | "friend" | "other";
};

export type Booking = {
  id: string;
  customer_id: string;
  event_id: string;
  party_size: number;
  note: string | null;
  status: BookingStatus;
  booked_at: string;
  canceled_at: string | null;
  /** 送迎の希望（集合場所コード。希望なし／未設定は null）。 */
  pickup: string | null;
  /** 体験乗馬（約5分）の希望（千葉のみ）。 */
  riding: boolean;
  /** 同伴者（最大3名）。 */
  companions: BookingCompanion[];
  event?: EventRow | null;
};

export type HorseMeetingStatus = "pending" | "approved" | "canceled" | "completed";

export type HorseMeetingRequest = {
  id: string;
  customer_id: string;
  applicant_name: string;
  facility: string;
  party_size: number;
  preferred_date: string;
  preferred_time_slot: string;
  supported_horses: string;
  arrival_method: string;
  pickup_time: string | null;
  note: string | null;
  status: HorseMeetingStatus;
  admin_note: string | null;
  requested_at: string;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Payment = {
  id: string;
  customer_id: string | null;
  contract_id: string | null;
  donation_id: string | null;
  kind: PaymentKind;
  amount: number;
  status: PaymentStatus;
  stripe_invoice_id: string | null;
  stripe_payment_intent_id: string | null;
  failure_reason: string | null;
  occurred_at: string;
};

export type SpecialTeamMembership = {
  id: string;
  customer_id: string;
  horse_id: string;
  monthly_amount: number;
  stripe_subscription_id: string | null;
  stripe_subscription_item_id: string | null;
  status: ContractStatus;
  team_name: string | null;
  started_at: string;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
  horse?: Horse | null;
};

export type NewsItem = {
  id: string;
  title: string;
  body: string | null;
  tag: string;
  tag_color: string;
  image_url: string | null;
  pdf_url: string | null;
  pdf_urls: string[] | null;
  /** pdf_urls と同じ並び順のアップロード時の元ファイル名。無い場合は連番表示にフォールバック。 */
  pdf_names: string[] | null;
  image_urls: string[] | null;
  published_at: string;
  is_published: boolean;
  public_access: "public" | "members_only";
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type CustomerSummary = {
  customer_id: string;
  full_name: string;
  email: string | null;
  status: CustomerStatus;
  /** 基本会員区分のみ（A/B/C）。RPT・特別チームは含まない。 */
  primary_plan_code: MemberPlanCode | null;
  primary_plan_name: string | null;
  /** 会員種別コード: 基本契約(A/B/C) → 無ければ支援(SUPPORT) → 無ければ null。 */
  member_class_code: MemberPlanCode | null;
  total_support_units: number;
  total_support_horses: number;
  monthly_total: number;
  next_payment_at: string | null;
  contract_status: ContractStatus | null;
  /** 特別参加: リタポ（RPT）契約が有効か。 */
  rpt_active: boolean;
  /** 特別参加: 有効な特別チーム会員の件数。 */
  special_team_count: number;
  /** 特別参加: チーム名（未設定は馬名で代替）。 */
  special_team_names: string[] | null;
};

// ---------------------------------------------------------------------
// 会員向けメッセージ配信（お知らせ閲覧 + メルマガ）
// ---------------------------------------------------------------------
export type MemberMessageStatus = "draft" | "scheduled" | "sending" | "sent" | "canceled";
export type MemberMessageAudience =
  | "all"
  | "subset"
  | "rpt_only"
  | "support_only"
  | "no_class"
  | "class_attender"
  | "class_owner"
  | "class_b"
  | "class_a"
  | "class_c"
  | "class_support"
  | "team_only";
export type MemberMessageBodyFormat = "html" | "text";
export type RecipientEmailStatus = "pending" | "sent" | "failed" | "skipped";

export type MemberMessage = {
  id: string;
  title: string;
  body: string;
  body_format: MemberMessageBodyFormat;
  tag: string;
  tag_color: string;
  channel_inapp: boolean;
  channel_email: boolean;
  audience: MemberMessageAudience;
  audiences: MemberMessageAudience[];
  target_customer_ids: string[];
  image_urls: string[];
  pdf_urls: string[];
  status: MemberMessageStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  recipient_count: number;
  sent_count: number;
  open_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------
// AIチャットボット（OpenAI + RAG）
// ---------------------------------------------------------------------
export type AppSetting = {
  key: string;
  value: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type KbEntry = {
  id: string;
  title: string;
  content: string;
  category: string;
  is_active: boolean;
  /** embedding はサーバ内部用。クライアントへは返さない。 */
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MemberMessageRecipient = {
  id: string;
  message_id: string;
  customer_id: string;
  email: string | null;
  token: string;
  email_status: RecipientEmailStatus;
  sent_at: string | null;
  opened_at: string | null;
  open_count: number;
  read_at: string | null;
  error: string | null;
  created_at: string;
  message?: MemberMessage | null;
};
