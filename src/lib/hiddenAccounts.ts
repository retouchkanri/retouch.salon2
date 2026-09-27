/**
 * 内部テスト用アカウントの非表示制御。
 *
 * ここに登録したメールアドレスのアカウントは Supabase 上には通常どおり
 * 保存される（監査・取消が可能）が、管理画面の一覧・検索には表示しない。
 * スキーマ変更は行わず、メールアドレスでの照合のみで除外する。
 */

/** 管理画面の一覧・検索から除外するメールアドレス（小文字で保持）。 */
export const HIDDEN_ACCOUNT_EMAILS: readonly string[] = ["kindman207@gmail.com"];

const HIDDEN_SET: ReadonlySet<string> = new Set(HIDDEN_ACCOUNT_EMAILS);

/** 指定メールが非表示対象なら true。空・null は false。 */
export function isHiddenAccountEmail(email?: string | null): boolean {
  return !!email && HIDDEN_SET.has(email.trim().toLowerCase());
}
