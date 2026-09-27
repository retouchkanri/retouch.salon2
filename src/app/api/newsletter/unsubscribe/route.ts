import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, message: string, ok: boolean): Response {
  const html = `<!DOCTYPE html>
<html lang="ja"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title></head>
<body style="margin:0;background:#f5f5f4;font-family:'Hiragino Kaku Gothic ProN',Meiryo,sans-serif;">
<div style="max-width:520px;margin:48px auto;padding:0 16px;">
<div style="background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:32px 28px;text-align:center;">
<div style="font-size:40px;margin-bottom:8px;">${ok ? "✅" : "⚠️"}</div>
<h1 style="font-size:20px;color:#1c1917;margin:0 0 12px;">${title}</h1>
<p style="font-size:15px;line-height:1.8;color:#57534e;margin:0;">${message}</p>
<p style="margin-top:24px;"><a href="/" style="color:#0f766e;">サイトトップへ</a></p>
</div>
<p style="text-align:center;color:#a8a29e;font-size:12px;margin-top:16px;">Retouchメンバーズサイト</p>
</div>
</body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

/**
 * メルマガ配信停止（ワンクリック）。メール footer のリンクから呼ばれる公開エンドポイント。
 * token から会員を特定し customers.newsletter_opt_out=true を設定する。
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t");
  if (!token) {
    return page("リンクが無効です", "配信停止リンクが正しくありません。お手数ですが事務局までお問い合わせください。", false);
  }
  try {
    const admin = createSupabaseAdminClient();
    const { data: rec } = await admin
      .from("member_message_recipients")
      .select("customer_id")
      .eq("token", token)
      .maybeSingle();
    if (!rec) {
      return page("リンクが無効です", "配信停止リンクが正しくありません。お手数ですが事務局までお問い合わせください。", false);
    }
    await admin
      .from("customers")
      .update({ newsletter_opt_out: true })
      .eq("id", (rec as any).customer_id);
    return page(
      "配信を停止しました",
      "メールマガジンの配信を停止しました。再開を希望される場合は、マイページの「メルマガ配信設定」から、または事務局までご連絡ください。",
      true,
    );
  } catch {
    return page("処理に失敗しました", "時間をおいて再度お試しいただくか、事務局までお問い合わせください。", false);
  }
}

// 一部メールクライアントは List-Unsubscribe を POST で叩く（One-Click）。同じ処理を許可。
export async function POST(req: Request) {
  return GET(req);
}
