-- Create news table for homepage news cards
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

CREATE INDEX IF NOT EXISTS idx_news_published ON news (is_published, published_at DESC);

ALTER TABLE news ENABLE ROW LEVEL SECURITY;

CREATE POLICY "news_public_read" ON news FOR SELECT USING (is_published = true);
CREATE POLICY "news_admin_all" ON news FOR ALL USING (true) WITH CHECK (true);

-- Seed initial news data
INSERT INTO news (title, body, tag, tag_color, image_url, published_at, sort_order) VALUES
  ('新しい支援馬「コスモブライト」を追加しました', '2024年引退のコスモブライトが牧場に到着しました。支援の受付を開始します。', 'お知らせ', 'bg-brand-50 text-brand-dark', 'https://images.unsplash.com/photo-1553284965-83fd3e82fa5a?w=600&h=300&fit=crop', '2026-05-20T00:00:00Z', 1),
  ('6月牧場見学会のお申込み受付開始', '6月14日（日）開催の牧場見学会の予約受付を開始いたしました。定員20名。', 'イベント', 'bg-amber-50 text-amber-800', 'https://images.unsplash.com/photo-1563830283-12f0a3ec7bf3?w=600&h=300&fit=crop', '2026-05-10T00:00:00Z', 2),
  ('メンバーズサイトをリニューアルしました', 'UI/UXを刷新し、支援状況の確認や口数変更がより簡単になりました。', 'リリース', 'bg-blue-50 text-blue-700', 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&h=300&fit=crop', '2026-04-28T00:00:00Z', 3),
  ('日本経済新聞で活動が紹介されました', '引退馬支援の取り組みが日経朝刊の社会面で取り上げられました。', 'メディア', 'bg-purple-50 text-purple-700', 'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=600&h=300&fit=crop', '2026-04-15T00:00:00Z', 4),
  ('年次活動報告書を公開しました', '2025年度の支援実績・会計報告をまとめた年次報告書をPDFで公開しています。', 'お知らせ', 'bg-brand-50 text-brand-dark', 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600&h=300&fit=crop', '2026-03-30T00:00:00Z', 5),
  ('春の感謝イベントを開催しました', '会員80名が参加。牧場でのBBQと馬とのふれあいを楽しんでいただきました。', 'イベント', 'bg-amber-50 text-amber-800', 'https://images.unsplash.com/photo-1530092285049-1c42085fd395?w=600&h=300&fit=crop', '2026-03-12T00:00:00Z', 6),
  ('冬季の馬たちの健康レポート', '獣医チームによる冬季健康診断の結果をご報告します。全頭健康状態良好です。', 'お知らせ', 'bg-brand-50 text-brand-dark', 'https://images.unsplash.com/photo-1598974357801-cbca100e65d3?w=600&h=300&fit=crop', '2026-02-20T00:00:00Z', 7),
  ('新年のご挨拶と2026年の活動計画', '新年あけましておめでとうございます。本年の活動計画をお知らせいたします。', 'お知らせ', 'bg-brand-50 text-brand-dark', 'https://images.unsplash.com/photo-1504208434388-831e4f559ceb?w=600&h=300&fit=crop', '2026-01-05T00:00:00Z', 8),
  ('Stripe決済システムをアップデートしました', 'より安全で迅速な決済処理を実現するため、決済基盤を更新しました。', 'リリース', 'bg-blue-50 text-blue-700', 'https://images.unsplash.com/photo-1556742031-c6961e8560b0?w=600&h=300&fit=crop', '2025-12-15T00:00:00Z', 9),
  ('年末年始の事務局休業のお知らせ', '12月29日〜1月3日まで事務局はお休みとなります。お問い合わせへのご返信は1月4日以降となります。', 'お知らせ', 'bg-brand-50 text-brand-dark', 'https://images.unsplash.com/photo-1482517967863-00e15c9b44be?w=600&h=300&fit=crop', '2025-12-10T00:00:00Z', 10),
  ('ホースセラピー体験プログラム開始', '引退馬と触れ合うホースセラピー体験プログラムの受付を開始しました。', 'イベント', 'bg-amber-50 text-amber-800', 'https://images.unsplash.com/photo-1450052590821-8bf91254a353?w=600&h=300&fit=crop', '2025-11-20T00:00:00Z', 11),
  ('支援者数600名を突破しました', '皆さまのおかげで支援者数が600名を超えました。心より感謝申し上げます。', 'お知らせ', 'bg-brand-50 text-brand-dark', 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=600&h=300&fit=crop', '2025-11-01T00:00:00Z', 12);
