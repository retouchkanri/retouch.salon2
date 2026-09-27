/**
 * Supabase/PostgREST は 1 リクエストで返す行数に上限（このプロジェクトでは 1000 行）を
 * 持つ。`.limit(50000)` のような大きな指定を書いても上限側が優先されるため、
 * 件数表示・集計・CSV 出力のように「全件」が前提の処理は必ずここを通すこと。
 *
 * 例（2026-08 実測）: payments は 16,305 行あるが、素のクエリは 1,000 行しか返さない。
 *
 * 使い方:
 *   const { rows, error } = await fetchAllRows((from, to) =>
 *     supabase.from("payments").select("*").order("occurred_at").range(from, to),
 *   );
 *
 * 注意: ページングの結果が安定するよう、呼び出し側で必ず .order() を指定すること。
 */

/** PostgREST が 1 レスポンスで返す最大行数（Supabase 既定値）。 */
export const PG_MAX_ROWS = 1000;

export type FetchAllResult<T> = { rows: T[]; error: any };

/**
 * `.range()` で最後まで辿って全行を取得する。
 *
 * エラーは投げずに返す。呼び出し側が握りつぶすかどうかを選べるようにするため
 * （既存コードの多くはエラー時も画面を出す挙動になっている）。エラーが発生した
 * 場合、`rows` にはそこまでに取得できた分が入る。
 */
export async function fetchAllRows<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: any; error: any }>,
  pageSize: number = PG_MAX_ROWS,
): Promise<FetchAllResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) return { rows, error };
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    // 取得件数が 1 ページ未満なら最終ページ。
    if (chunk.length < pageSize) break;
  }
  return { rows, error: null };
}

/**
 * `.in("col", ids)` を安全なチャンクに割って全件取得する。
 * ids が多いと URL 長と行数上限の両方に引っかかるため。
 */
export async function fetchAllByIds<T = any>(
  ids: string[],
  build: (chunk: string[], from: number, to: number) => PromiseLike<{ data: any; error: any }>,
  chunkSize = 200,
): Promise<FetchAllResult<T>> {
  const rows: T[] = [];
  if (ids.length === 0) return { rows, error: null };
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const res = await fetchAllRows<T>((from, to) => build(chunk, from, to));
    rows.push(...res.rows);
    if (res.error) return { rows, error: res.error };
  }
  return { rows, error: null };
}
