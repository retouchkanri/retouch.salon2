import { randomBytes } from "crypto";

/**
 * 2段階（メール確認付き）会員登録フローの共通ヘルパー。
 *   - 確認トークンの生成
 *   - 詳細プロフィール項目から既存カラム（full_name / address1 等）への合成
 *
 * 合成方針：新カラム（姓名・住所の分割）を正本としつつ、既存の読取コード
 * （マイページ・管理画面・メールテンプレート）が参照する full_name /
 * address1 / address2 を常に同期させ、後方互換を保つ。
 * full_name_kana は氏名の読み仮名ではなく「ニックネーム」項目として独立に
 * 扱い、ユーザーの入力値をそのまま書き込む（自動合成しない）。
 */

/** 確認トークンの有効期限（ミリ秒）。24時間。 */
export const REGISTRATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** URL セーフな確認トークンを生成する。 */
export function generateRegistrationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** 姓・名を結合して表示名（full_name）にする。空要素は除外。 */
export function composeFullName(
  lastName?: string | null,
  firstName?: string | null,
): string {
  return [lastName, firstName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/** 都道府県・市・町を結合して address1 にする。空要素は除外。 */
export function composeAddress1(
  prefecture?: string | null,
  city?: string | null,
  town?: string | null,
): string {
  return [prefecture, city, town]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join("");
}

/**
 * 詳細プロフィール項目から、customers に書き込む合成カラムを組み立てる。
 * 新カラムと合成カラムをまとめて返すので、そのまま update のパッチに展開できる。
 *
 * 注意：full_name_kana は「ニックネーム」表示用の項目であり、氏名の読み仮名とは
 * 独立している。ここでは合成せず、呼び出し側がニックネーム入力値をそのまま
 * 書き込むこと。
 */
export function buildCustomerSyncPatch(input: {
  last_name?: string | null;
  first_name?: string | null;
  prefecture?: string | null;
  address_city?: string | null;
  address_town?: string | null;
  address_building?: string | null;
}): {
  full_name: string;
  address1: string;
  address2: string;
} {
  return {
    full_name: composeFullName(input.last_name, input.first_name),
    address1: composeAddress1(
      input.prefecture,
      input.address_city,
      input.address_town,
    ),
    address2: (input.address_building ?? "").trim(),
  };
}

/** メールアドレスのローカル部（NOT NULL な full_name の暫定値に使う）。 */
export function emailLocalPart(email: string): string {
  return email.split("@")[0] || "会員";
}
