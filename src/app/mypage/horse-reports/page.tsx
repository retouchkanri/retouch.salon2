import Link from "next/link";
import { monthLabel } from "@/lib/monthlyReport";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function MemberHorseReportsPage() {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("horse_reports")
    .select("horse_id, year_month, body, horses(name)")
    .not("published_at", "is", null)
    .order("year_month", { ascending: false })
    .limit(60);
  const rows = error ? [] : (data ?? []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">馬の月次報告</h1>
      <p className="text-sm text-ink-soft">公開された馬の近況です。馬の紹介そのものは <a className="text-brand underline" href="https://retouch.news/" target="_blank" rel="noreferrer">retouch.news</a> で読めます。</p>
      {rows.length === 0 ? <p className="card text-sm text-ink-soft">公開された馬の報告はまだありません。</p> : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {rows.map((row) => {
            const horse = Array.isArray(row.horses) ? row.horses[0] : row.horses;
            const name = (horse as { name?: string } | null)?.name ?? "馬";
            return (
              <li key={`${row.horse_id}-${row.year_month}`} className="card">
                <p className="font-bold">{name}</p>
                <p className="text-xs text-ink-soft">{monthLabel(row.year_month as string)}</p>
                <p className="mt-2 line-clamp-4 text-sm whitespace-pre-wrap">{row.body as string}</p>
              </li>
            );
          })}
        </ul>
      )}
      <Link href="/mypage/reports" className="text-sm text-brand underline">決済報告を見る</Link>
    </div>
  );
}
