/**
 * コミュニティ管理（管理画面・管理 API 用。サーバー側でサービスロールを使う）。
 * 呼び出し側で requireCapability("community.manage") を済ませてから使うこと。
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AUDIENCES,
  CATEGORIES,
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  CHANNEL_TOPIC_MAX,
  COMMUNITY_BUCKET,
  MEMBER_CODES,
} from "./constants";

type Admin = SupabaseClient<any, any, any>;

/** community.sql が適用済みか（テーブルが存在するか）。 */
export async function communityInstalled(admin: Admin): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await admin.from("community_channels").select("id", { head: true, count: "exact" }).limit(1);
  if (!error) return { ok: true, error: null };
  return { ok: false, error: error.message };
}

/**
 * 運営アカウントのコミュニティ用プロフィールを用意する（一括送信の差出人名など）。
 * 既にある場合は変更しない。
 */
export async function ensureStaffProfile(admin: Admin, userId: string): Promise<void> {
  const { data: existing } = await admin.from("community_profiles").select("user_id").eq("user_id", userId).maybeSingle();
  if (existing) return;
  const { data: cust } = await admin
    .from("customers")
    .select("full_name, avatar_url")
    .eq("auth_user_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const name = ((cust?.full_name as string | null) ?? "").trim() || "Retouch運営";
  await admin.from("community_profiles").insert({
    user_id: userId,
    display_name: name.slice(0, 40),
    avatar_url: (cust?.avatar_url as string | null) ?? null,
    is_staff: true,
  });
}

// ---------------------------------------------------------------------------
// チャンネルの入力
// ---------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const channelInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "チャンネル名を入力してください")
      .max(CHANNEL_NAME_MAX, `チャンネル名は${CHANNEL_NAME_MAX}文字以内で入力してください`),
    description: optionalText(CHANNEL_DESCRIPTION_MAX),
    topic: optionalText(CHANNEL_TOPIC_MAX),
    category: z.enum(CATEGORIES),
    visibility: z.enum(["public", "private"]),
    audience: z.enum(AUDIENCES),
    audience_plan_codes: z.array(z.enum(MEMBER_CODES)).max(MEMBER_CODES.length).default([]),
    audience_horse_ids: z.array(z.string().uuid()).max(500).default([]),
    post_policy: z.enum(["everyone", "staff"]),
    auto_join: z.boolean(),
    is_required: z.boolean(),
    sort_order: z.number().int().min(-100000).max(100000),
    is_archived: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.audience === "plans" && v.audience_plan_codes.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "対象の会員種別を1つ以上選択してください", path: ["audience_plan_codes"] });
    }
  });

export type ChannelInput = z.infer<typeof channelInputSchema>;

/** 対象者と関係のない指定を取り除き、DB に保存する形にする。 */
export async function normalizeChannelInput(admin: Admin, v: ChannelInput) {
  let horseIds: string[] = [];
  if (v.audience === "supporters" && v.audience_horse_ids.length > 0) {
    const { data } = await admin.from("horses").select("id").in("id", Array.from(new Set(v.audience_horse_ids)));
    horseIds = (data ?? []).map((h: any) => h.id as string);
  }
  const isPrivate = v.visibility === "private";
  return {
    name: v.name,
    description: v.description ?? null,
    topic: v.topic ?? null,
    category: v.category,
    visibility: v.visibility,
    audience: v.audience,
    audience_plan_codes: v.audience === "plans" ? Array.from(new Set(v.audience_plan_codes)) : [],
    audience_horse_ids: horseIds,
    post_policy: v.post_policy,
    // 非公開チャンネルは招待制のため、自動参加・退出不可は使わない
    auto_join: isPrivate ? false : v.auto_join,
    is_required: isPrivate ? false : v.is_required && v.auto_join,
    sort_order: v.sort_order,
    ...(v.is_archived === undefined ? {} : { is_archived: v.is_archived }),
  };
}

export function channelErrorMessage(error: { code?: string; message?: string } | null): string {
  if (!error) return "保存できませんでした。";
  if (error.code === "23505") return "同じ名前のチャンネルがすでにあります。";
  return error.message ?? "保存できませんでした。";
}

// ---------------------------------------------------------------------------
// モデレーション
// ---------------------------------------------------------------------------

/** 運営によるメッセージ削除（DM を含む。通報対応用）。削除済みなら何もしない。 */
export async function moderateDeleteMessage(admin: Admin, messageId: string, staffId: string): Promise<boolean> {
  const { data: msg, error } = await admin
    .from("community_messages")
    .select("id, parent_id, deleted_at, attachments")
    .eq("id", messageId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!msg) return false;
  if (msg.deleted_at) return true;

  const { error: upErr } = await admin
    .from("community_messages")
    .update({
      body: "",
      attachments: [],
      mentions: [],
      mention_channel: false,
      reactions: {},
      is_pinned: false,
      pinned_by: null,
      pinned_at: null,
      deleted_at: new Date().toISOString(),
      deleted_by: staffId,
    })
    .eq("id", messageId)
    .is("deleted_at", null);
  if (upErr) throw new Error(upErr.message);

  if (msg.parent_id) {
    const { data: parent } = await admin
      .from("community_messages")
      .select("reply_count")
      .eq("id", msg.parent_id)
      .maybeSingle();
    if (parent) {
      await admin
        .from("community_messages")
        .update({ reply_count: Math.max(Number(parent.reply_count ?? 0) - 1, 0) })
        .eq("id", msg.parent_id);
    }
  }

  const paths = (Array.isArray(msg.attachments) ? msg.attachments : [])
    .map((a: any) => a?.path)
    .filter((p: unknown): p is string => typeof p === "string" && p.length > 0);
  if (paths.length > 0) await admin.storage.from(COMMUNITY_BUCKET).remove(paths);
  return true;
}

/** チャンネル削除時に、そのチャンネルの添付ファイルを Storage から削除する（失敗しても続行）。 */
export async function removeChannelFiles(admin: Admin, channelId: string): Promise<void> {
  try {
    const bucket = admin.storage.from(COMMUNITY_BUCKET);
    const { data: folders } = await bucket.list(channelId, { limit: 1000 });
    for (const folder of folders ?? []) {
      const prefix = `${channelId}/${folder.name}`;
      const { data: files } = await bucket.list(prefix, { limit: 1000 });
      const paths = (files ?? []).map((f) => `${prefix}/${f.name}`);
      if (paths.length > 0) await bucket.remove(paths);
    }
  } catch {
    // 添付ファイルの掃除に失敗してもチャンネルの削除自体は完了している
  }
}

/** PostgREST の setof uuid 戻り値（スカラー配列 / オブジェクト配列のどちらでも）を配列にする。 */
export function toUuidList(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((r) => (typeof r === "string" ? r : r && typeof r === "object" ? (Object.values(r)[0] as unknown) : null))
    .filter((v): v is string => typeof v === "string");
}

/** 顧客ID → ログイン用ユーザーID（ログイン未設定の顧客は含まれない）。 */
export async function customerIdsToUserIds(admin: Admin, customerIds: string[]): Promise<string[]> {
  if (customerIds.length === 0) return [];
  const { data, error } = await admin
    .from("customers")
    .select("auth_user_id")
    .in("id", Array.from(new Set(customerIds)).slice(0, 1000));
  if (error) throw new Error(error.message);
  return Array.from(new Set((data ?? []).map((r: any) => r.auth_user_id as string | null).filter((v): v is string => !!v)));
}
