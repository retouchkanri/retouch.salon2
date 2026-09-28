/**
 * コミュニティ（チャット）添付ファイルのサーバー側処理。実体は VPS の
 * <FILE_STORAGE_DIR>/community/<channel_id>/<user_id>/<file>（src/lib/fileStorage.ts）。
 *
 * 権限の判定は従来の Supabase Storage のポリシーと同じ DB 関数
 * （community_storage_can_read / _upload / _delete）を、ログイン中のユーザーとして呼んで行う。
 */
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeGetUser } from "@/lib/supabase/safe-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deleteFile, deleteFolder, saveFile } from "@/lib/fileStorage";
import { COMMUNITY_BUCKET } from "./constants";

type Check = "community_storage_can_read" | "community_storage_can_upload" | "community_storage_can_delete";

export async function communityUser() {
  const db = createSupabaseServerClient();
  const { user } = await safeGetUser(db as any);
  return user ? { db, userId: user.id } : null;
}

export async function communityFileAllowed(
  db: ReturnType<typeof createSupabaseServerClient>,
  fn: Check,
  path: string,
): Promise<boolean> {
  const { data, error } = await db.rpc(fn, { p_name: path });
  return !error && data === true;
}

/**
 * VPS に無いファイルを旧 Supabase Storage（community バケット）から取得して VPS に保存する。
 * 移行スクリプト実行前・実行中でも、既存の添付ファイルがそのまま表示されるようにするため。
 */
export async function pullLegacyCommunityFile(path: string): Promise<boolean> {
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin.storage.from(COMMUNITY_BUCKET).download(path);
    if (error || !data) return false;
    await saveFile("community", path, Buffer.from(await data.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

/** 添付ファイルを削除する（VPS と、移行前に残っている旧 Supabase Storage の複製の両方）。権限確認は呼び出し側で行う。 */
export async function removeCommunityFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    await deleteFile("community", p).catch(() => undefined);
  }
  if (paths.length > 0) {
    try {
      await createSupabaseAdminClient().storage.from(COMMUNITY_BUCKET).remove(paths);
    } catch {
      // 旧 Storage 側に無い・到達できない場合も VPS 側の削除は完了している
    }
  }
}

/** チャンネル単位で添付ファイルを削除する（VPS のフォルダごと）。 */
export async function removeCommunityChannelFolder(channelId: string): Promise<void> {
  await deleteFolder("community", channelId);
}
