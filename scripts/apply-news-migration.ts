import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function run() {
  // Create table
  const { error: e1 } = await supabase.rpc("exec_sql" as any, {
    query: `
      CREATE TABLE IF NOT EXISTS news (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        title text NOT NULL,
        body text,
        tag text NOT NULL DEFAULT 'お知らせ',
        tag_color text NOT NULL DEFAULT 'bg-brand-50 text-brand-dark',
        image_url text,
        published_at timestamptz NOT NULL DEFAULT now(),
        is_published boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
    `,
  });

  if (e1) {
    console.log("RPC not available, trying direct insert approach...");
    // Table might already exist or we need to create it via Supabase Dashboard.
    // Let's try inserting directly - if the table exists, this will work.
  }

  // Try inserting seed data
  const seedData = [
    { title: "新しい支援馬「コスモブライト」を追加しました", body: "2024年引退のコスモブライトが牧場に到着しました。支援の受付を開始します。", tag: "お知らせ", tag_color: "bg-brand-50 text-brand-dark", image_url: "https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=600&h=300&fit=crop", published_at: "2026-05-20T00:00:00Z", sort_order: 1 },
    { title: "6月牧場見学会のお申込み受付開始", body: "6月14日（日）開催の牧場見学会の予約受付を開始いたしました。定員20名。", tag: "イベント", tag_color: "bg-amber-50 text-amber-800", image_url: "https://images.unsplash.com/photo-1563830283-12f0a3ec7bf3?w=600&h=300&fit=crop", published_at: "2026-05-10T00:00:00Z", sort_order: 2 },
    { title: "メンバーズサイトをリニューアルしました", body: "UI/UXを刷新し、支援状況の確認や口数変更がより簡単になりました。", tag: "リリース", tag_color: "bg-blue-50 text-blue-700", image_url: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&h=300&fit=crop", published_at: "2026-04-28T00:00:00Z", sort_order: 3 },
    { title: "日本経済新聞で活動が紹介されました", body: "引退馬支援の取り組みが日経朝刊の社会面で取り上げられました。", tag: "メディア", tag_color: "bg-purple-50 text-purple-700", image_url: "https://images.unsplash.com/photo-1495020689067-958852a7765e?w=600&h=300&fit=crop", published_at: "2026-04-15T00:00:00Z", sort_order: 4 },
    { title: "年次活動報告書を公開しました", body: "2025年度の支援実績・会計報告をまとめた年次報告書をPDFで公開しています。", tag: "お知らせ", tag_color: "bg-brand-50 text-brand-dark", image_url: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600&h=300&fit=crop", published_at: "2026-03-30T00:00:00Z", sort_order: 5 },
    { title: "春の感謝イベントを開催しました", body: "会員80名が参加。牧場でのBBQと馬とのふれあいを楽しんでいただきました。", tag: "イベント", tag_color: "bg-amber-50 text-amber-800", image_url: "https://images.unsplash.com/photo-1530092285049-1c42085fd395?w=600&h=300&fit=crop", published_at: "2026-03-12T00:00:00Z", sort_order: 6 },
    { title: "冬季の馬たちの健康レポート", body: "獣医チームによる冬季健康診断の結果をご報告します。全頭健康状態良好です。", tag: "お知らせ", tag_color: "bg-brand-50 text-brand-dark", image_url: "https://images.unsplash.com/photo-1598974357801-cbca100e65d3?w=600&h=300&fit=crop", published_at: "2026-02-20T00:00:00Z", sort_order: 7 },
    { title: "新年のご挨拶と2026年の活動計画", body: "新年あけましておめでとうございます。本年の活動計画をお知らせいたします。", tag: "お知らせ", tag_color: "bg-brand-50 text-brand-dark", image_url: "https://images.unsplash.com/photo-1504208434388-831e4f559ceb?w=600&h=300&fit=crop", published_at: "2026-01-05T00:00:00Z", sort_order: 8 },
    { title: "Stripe決済システムをアップデートしました", body: "より安全で迅速な決済処理を実現するため、決済基盤を更新しました。", tag: "リリース", tag_color: "bg-blue-50 text-blue-700", image_url: "https://images.unsplash.com/photo-1556742031-c6961e8560b0?w=600&h=300&fit=crop", published_at: "2025-12-15T00:00:00Z", sort_order: 9 },
    { title: "年末年始の事務局休業のお知らせ", body: "12月29日〜1月3日まで事務局はお休みとなります。お問い合わせへのご返信は1月4日以降となります。", tag: "お知らせ", tag_color: "bg-brand-50 text-brand-dark", image_url: "https://images.unsplash.com/photo-1482517967863-00e15c9b44be?w=600&h=300&fit=crop", published_at: "2025-12-10T00:00:00Z", sort_order: 10 },
    { title: "ホースセラピー体験プログラム開始", body: "引退馬と触れ合うホースセラピー体験プログラムの受付を開始しました。", tag: "イベント", tag_color: "bg-amber-50 text-amber-800", image_url: "https://images.unsplash.com/photo-1450052590821-8bf91254a353?w=600&h=300&fit=crop", published_at: "2025-11-20T00:00:00Z", sort_order: 11 },
    { title: "支援者数600名を突破しました", body: "皆さまのおかげで支援者数が600名を超えました。心より感謝申し上げます。", tag: "お知らせ", tag_color: "bg-brand-50 text-brand-dark", image_url: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600&h=300&fit=crop", published_at: "2025-11-01T00:00:00Z", sort_order: 12 },
  ];

  const { error: insertErr, data } = await supabase.from("news").insert(seedData).select("id");
  if (insertErr) {
    console.error("Insert error:", insertErr.message);
    if (insertErr.message.includes("relation") && insertErr.message.includes("does not exist")) {
      console.log("\n⚠️  The 'news' table does not exist yet.");
      console.log("Please run the following SQL in your Supabase Dashboard SQL Editor:");
      console.log("File: supabase/migrations/20260528_create_news.sql\n");
    }
    process.exit(1);
  }

  console.log(`✅ Inserted ${data.length} news items successfully.`);
}

run();
