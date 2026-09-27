# Retouchメンバーズサイト – 公式リニューアル版（Milestone 2 実装）

引退競走馬支援「Retouchメンバーズサイト」の会員・支援・寄付・予約管理基盤（Next.js + Supabase + Stripe）。

本リポジトリは、現行サイト **<https://retouch-members.com/>**（WordPress ベース・会員約 600 名）の **公式リニューアル版** であり、**マイルストーン 2（基盤開発・会員／支援管理構築）** の実装成果物です。ブランド（ロゴ・配色・キービジュアル `bg.png`）および書体（ロゴ書体に合わせた Pacifico、本文の Noto Sans JP）は旧サイトの世界観を継承しています。

### 旧サイトで顕在化していた課題と本リニューアルでの対応

| 旧サイトの課題 | 本リニューアルでの対応 |
| :-- | :-- |
| 会員様が「自分の支援状況」を把握しづらい | `/mypage` トップに会員種別／支援頭数／月額合計／予約をワンビュー表示し、決済状態と次回決済日も同一画面で提示 |
| 支援の追加・変更の導線が分かりにくい | 「新しい支援を追加」CTA を上部固定、各支援に「変更する／停止する」ボタンを近接配置（3 ステップウィザード） |
| 決済エラー対応が手動になっている | Stripe Webhook（`invoice.payment_failed` ほか）で自動同期し、会員側にも警告バナー＋ Stripe Customer Portal 直行ボタンを表示 |
| 管理側の把握・整理に時間がかかる | `/admin` ダッシュボード＋顧客 1 画面集約（会員／支援／契約／寄付／見学／決済）＋ CSV 入出力＋内部メモ 3 スロット |

## 主要機能

### 会員向け（/mypage）
- マイページトップ：会員種別・支援中の馬／口数・月額合計・決済状態・次回決済日を一目で把握
- 支援追加（3ステップのウィザード：馬選択 → 口数 → 内容確認）
- 支援変更／停止（現在内容と変更後の比較、停止確認）
- 単発寄付（Stripe Checkout 連携）
- 見学会／個別見学の予約・キャンセル（対象者制御、空席表示）
- 登録情報の編集
- 履歴一覧（寄付・見学・決済）

### 運営管理（/admin）
- ダッシュボード（会員数・決済失敗・今日の予約・直近の動き）
- 顧客一覧：氏名／メールで横断検索、会員種別・決済状態・会員状態フィルタ
- 顧客詳細：会員／支援／契約／寄付／見学／決済 の全履歴を1画面で、内部メモ3スロット、会員ステータス
- 馬マスタ／イベントマスタ／予約管理
- CSV インポート／エクスポート（UTF-8 BOM付き）
- Stripe Webhook で契約・決済状態を同期

## 技術スタック

- Next.js 14 (App Router) + TypeScript + Tailwind CSS
- Supabase（PostgreSQL + Auth + Row Level Security）
- Stripe（Checkout / Customer Portal / Webhook）

## セットアップ手順

### 1. 依存関係のインストール

```bash
npm install
```

### 2. Supabase のスキーマ適用（最重要）

`supabase/migrations/all.sql` の全文を以下のいずれかの方法で適用します。

**方法 A. Supabase SQL Editor（推奨・最短）**

1. Supabase ダッシュボード → SQL Editor を開く
2. `supabase/migrations/all.sql` の全文をコピーして貼り付け
3. 「Run」を押す（30 秒ほどで完了）

**方法 B. Supabase CLI（`supabase/config.toml` とリンクしている場合）**

```bash
npx supabase link --project-ref eynadmhipgeqhrlkdixm
npx supabase db push
```

適用の成功は次で確認できます。

```bash
npx tsx scripts/smoke-test.ts
```

全テーブルが `✅` になっていれば OK です。

### 3. 環境変数の設定

`.env.local` を確認します（`.env.local.example` 参照）。Supabase URL / 公開鍵 / サービスロールキーが既に設定されています。Stripe を使う場合は、`STRIPE_*` を本番／テストキーに置き換えてください。

### 4. 管理者ユーザの作成

```bash
npx tsx scripts/create-admin.ts admin@example.com YourPassword123 "運営チーム"
```

### 5. サンプルデータ投入（任意）

```bash
npm run seed
```

### 6. 開発サーバの起動

```bash
npm run dev
```

- 会員サイト：http://localhost:3000
- 管理画面：http://localhost:3000/admin

### 7. Stripe Webhook の設定

Stripe ダッシュボードから、次のイベントをアプリの `/api/stripe/webhook` に送信するように設定し、Webhook シークレットを `.env.local` の `STRIPE_WEBHOOK_SECRET` に設定します。

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

ローカル開発では `stripe listen --forward-to localhost:3000/api/stripe/webhook` が便利です。

## ディレクトリ構成

```
src/
  app/
    page.tsx                    ── 公開トップ
    login / signup              ── 認証
    mypage/                     ── 会員マイページ
      supports/{new,[id]/stop}  ── 支援追加／変更／停止
      donate                    ── 単発寄付
      bookings                  ── 見学会・個別見学
      history                   ── 履歴
      profile                   ── 登録情報編集
    admin/
      login/                    ── 管理者ログイン
      (protected)/              ── 要ログイン（管理者）配下
        page.tsx                ── ダッシュボード
        customers / [id]        ── 顧客一覧・詳細
        horses / events         ── マスタ管理
        bookings / csv          ── 予約・CSV
    api/
      auth/* mypage/* admin/*   ── 各 REST エンドポイント
      stripe/{webhook,portal}   ── Stripe 連携
  lib/
    supabase/                   ── SSR / browser / admin クライアント
    auth.ts                     ── セッション取得・ガード
    stripe.ts                   ── Stripe クライアント
    constraints.ts              ── 併用ルール（A/B/C・支援・特別チーム）
    format.ts csv.ts            ── ユーティリティ
  types/db.ts                   ── Supabase テーブル型定義
supabase/migrations/            ── スキーマ（0001）・seed（0002）
scripts/                        ── 管理者作成・サンプル投入
```

## マイルストーン 1 との対応

| 設計書 | 実装対応 |
| :-- | :-- |
| MS1-01 要件整理書 | 本READMEの「主要機能」｜継続率向上の最優先を実装 |
| MS1-02 機能要件定義書 | 会員向け／運営向け／共通基盤 すべて実装 |
| MS1-03 画面設計書（会員UI） | `/mypage` 配下の各画面でワイヤ通り実装 |
| MS1-04 データ構造設計書 | `supabase/migrations/0001_init.sql` |
| MS1-05 移行方針整理書 | `/admin/csv` による CSV 一括入出力 |
| MS1-06 Stripe連携設計書 | `/api/stripe/webhook` + Customer Portal |
| MS1-07 管理画面設計書 | `/admin/(protected)` 配下で再現 |

## 運用上のメモ

- 支援・決済状態の同期は Stripe Webhook 経由。本番公開前に Webhook シークレットを必ず設定してください。
- 既存 600 名の会員データ移行は、`管理データー【管理厳重】.xlsx` を CSV エクスポートし、`/admin/csv` から段階的に投入します（項目対応：氏名→`full_name`、メール→`email`、住所→`address1/2` など）。
- RLS により、会員は自分の `customer_id` のレコードのみ参照・編集できます。運営は `profiles.role = 'admin' | 'staff'`。
