// Helpers for server-side admin list search.
//
// Admin list pages paginate on the server (`.range(...)`). Searching must run
// in the database BEFORE that range is applied, otherwise the search only sees
// the rows already on the open page (and the total count is wrong).
//
// PostgREST `.or()` can't combine conditions across a base table and an embedded
// (joined) table in one expression. So to search by a joined table's column
// (e.g. a contract's customer name), we first resolve the matching ids in that
// table and then filter the base table with `<fk>.in.(...)`.

// PostgREST `.or()` splits on commas / parentheses and treats `*` as the ilike
// wildcard. Strip those so a raw user string can't break the filter expression.
export function sanitizeSearch(q: string): string {
  return q.replace(/[%*,()]/g, "").trim();
}

// A uuid that never exists — used to force an empty result set when a search
// term matches nothing in any of the joined tables.
export const NO_MATCH_ID = "00000000-0000-0000-0000-000000000000";

// Resolve ids of rows in `table` where any of `columns` match `q`
// (case-insensitive substring). Capped because the ids are inlined into a
// follow-up `.in(...)` filter (URL length): real name/email searches match only
// a handful of rows, so the cap is just a pathological-case backstop.
export async function resolveMatchingIds(
  supabase: any,
  table: string,
  columns: string[],
  q: string,
  cap = 1000,
): Promise<string[]> {
  const safe = sanitizeSearch(q);
  if (!safe) return [];
  const or = columns.map((c) => `${c}.ilike.*${safe}*`).join(",");
  const { data } = await supabase.from(table).select("id").or(or).limit(cap);
  return (data ?? []).map((r: any) => r.id as string);
}
