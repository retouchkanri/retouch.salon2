import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 1x1 透明GIF（開封トラッキング用ピクセル）
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64",
);

function pixelResponse() {
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "content-type": "image/gif",
      "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "pragma": "no-cache",
      "expires": "0",
    },
  });
}

/**
 * メルマガ開封トラッキング。メール本文に埋め込んだ 1x1 GIF が読み込まれると、
 * 該当 recipient の開封日時・回数を更新する。初回開封時は配信物の open_count も加算。
 * 公開エンドポイント（認証不要）。トークンが不正でもピクセルは常に返す。
 */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  try {
    const token = params.token;
    if (token) {
      const admin = createSupabaseAdminClient();
      const { data: rec } = await admin
        .from("member_message_recipients")
        .select("id, message_id, opened_at, open_count")
        .eq("token", token)
        .maybeSingle();
      if (rec) {
        const firstOpen = !(rec as any).opened_at;
        await admin
          .from("member_message_recipients")
          .update({
            open_count: ((rec as any).open_count ?? 0) + 1,
            opened_at: (rec as any).opened_at ?? new Date().toISOString(),
          })
          .eq("id", (rec as any).id);

        if (firstOpen) {
          const { data: msg } = await admin
            .from("member_messages")
            .select("open_count")
            .eq("id", (rec as any).message_id)
            .maybeSingle();
          if (msg) {
            await admin
              .from("member_messages")
              .update({ open_count: ((msg as any).open_count ?? 0) + 1 })
              .eq("id", (rec as any).message_id);
          }
        }
      }
    }
  } catch {
    // トラッキング失敗はピクセル配信を妨げない
  }
  return pixelResponse();
}
