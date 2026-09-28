/**
 * コミュニティでメールアドレスを他の会員に公開するかの設定。
 * ログイン用アカウントの user_metadata に保存する（DB のテーブル変更は不要）。既定は非公開。
 */
export const SHOW_EMAIL_KEY = "community_show_email";

export function isEmailPublic(userMetadata: Record<string, unknown> | null | undefined): boolean {
  return userMetadata?.[SHOW_EMAIL_KEY] === true;
}
