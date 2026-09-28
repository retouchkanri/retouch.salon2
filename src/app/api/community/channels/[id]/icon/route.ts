import { NextResponse } from "next/server";
import { communityUser } from "@/lib/community/files";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deleteFile, extensionForType, PUBLIC_URL_PREFIX, savePublicUpload } from "@/lib/fileStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 2 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const ICON_FOLDER = "community-icons/";

type Admin = ReturnType<typeof createSupabaseAdminClient>;

/**
 * チャンネルのアイコンを変更できるか（チャンネルの作成者と運営。アーカイブ済みは不可）。
 * community__can_manage と同じ規則。DM には設定できない。
 */
async function authorize(admin: Admin, channelId: string, userId: string) {
  const { data: base } = await admin
    .from("community_channels")
    .select("id, kind, created_by, is_archived")
    .eq("id", channelId)
    .maybeSingle();
  if (!base || base.kind !== "channel") return { error: "チャンネルが見つかりません。", status: 404 } as const;
  // icon 列はデータベースの更新（20260928_community_channel_icons.sql）で追加される
  const { data: withIcon } = await admin.from("community_channels").select("icon").eq("id", channelId).maybeSingle();
  const ch = { ...base, icon: (withIcon as { icon?: string | null } | null)?.icon ?? null };
  if (ch.is_archived) return { error: "アーカイブされたチャンネルは変更できません。", status: 403 } as const;
  if (ch.created_by !== userId) {
    const { data: p } = await admin.from("profiles").select("role").eq("id", userId).maybeSingle();
    if (!p || !["owner", "admin", "moderator"].includes(String(p.role))) {
      return { error: "アイコンを変更できるのはチャンネルの作成者と運営のみです。", status: 403 } as const;
    }
  }
  return { ch } as const;
}

/** 以前アップロードしたアイコン画像を削除する（絵文字や他の場所の画像は何もしない）。 */
async function removeOldIcon(icon: string | null | undefined) {
  if (!icon || !icon.startsWith(PUBLIC_URL_PREFIX + ICON_FOLDER)) return;
  try {
    await deleteFile("public", decodeURIComponent(icon.slice(PUBLIC_URL_PREFIX.length)));
  } catch {
    // 古いファイルの削除に失敗しても、アイコンの変更自体は完了している
  }
}

async function saveIcon(admin: Admin, channelId: string, icon: string | null) {
  const { error } = await admin.from("community_channels").update({ icon }).eq("id", channelId);
  if (!error) return null;
  if (/icon/.test(error.message) && /column|schema cache/i.test(error.message)) {
    return "チャンネルのアイコンは準備中です（データベースの更新後にご利用いただけます）。";
  }
  return "アイコンを保存できませんでした。";
}

/** アイコンを設定する（multipart の file = 画像、または JSON の { emoji }）。 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  const auth = await communityUser();
  if (!auth) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const ok = await authorize(admin, params.id, auth.userId);
  if ("error" in ok) return NextResponse.json({ error: ok.error }, { status: ok.status });

  let icon: string;
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const fd = await req.formData().catch(() => null);
    const file = fd?.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "画像が選択されていません。" }, { status: 400 });
    }
    if (file.size > MAX_BYTES) return NextResponse.json({ error: "画像は2MB以内にしてください。" }, { status: 400 });
    const ext = extensionForType(file.type);
    if (!ALLOWED.has(file.type) || !ext) {
      return NextResponse.json({ error: "JPEG・PNG・WEBP・GIF の画像を選んでください。" }, { status: 400 });
    }
    try {
      icon = await savePublicUpload(
        `${ICON_FOLDER}${params.id}-${Date.now()}.${ext}`,
        Buffer.from(await file.arrayBuffer()),
      );
    } catch {
      return NextResponse.json({ error: "画像を保存できませんでした。" }, { status: 500 });
    }
  } else {
    const body = await req.json().catch(() => null);
    const emoji = typeof body?.emoji === "string" ? body.emoji.trim() : "";
    // 絵文字1つ（パスや長い文字列は受け付けない）
    if (!emoji || emoji.length > 16 || /[\/\\<>\s]/.test(emoji) || /[A-Za-z0-9]/.test(emoji)) {
      return NextResponse.json({ error: "絵文字を1つ選んでください。" }, { status: 400 });
    }
    icon = emoji;
  }

  const problem = await saveIcon(admin, params.id, icon);
  if (problem) {
    await removeOldIcon(icon);
    return NextResponse.json({ error: problem }, { status: 500 });
  }
  await removeOldIcon(ok.ch.icon);
  return NextResponse.json({ ok: true, icon });
}

/** アイコンを外す（# / 鍵のマークに戻す）。 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 400 });
  const auth = await communityUser();
  if (!auth) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  const admin = createSupabaseAdminClient();
  const ok = await authorize(admin, params.id, auth.userId);
  if ("error" in ok) return NextResponse.json({ error: ok.error }, { status: ok.status });

  const problem = await saveIcon(admin, params.id, null);
  if (problem) return NextResponse.json({ error: problem }, { status: 500 });
  await removeOldIcon(ok.ch.icon);
  return NextResponse.json({ ok: true, icon: null });
}
