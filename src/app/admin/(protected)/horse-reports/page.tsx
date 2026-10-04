import { requireAdmin } from "@/lib/auth";
import { isFoundingSupporter, supportStars } from "@/lib/donationInsight";
import { fetchAllRows } from "@/lib/fetchAll";
import { formatUnits } from "@/lib/format";
import { availableSupportUnits, compareHorsesByNumber, horseCapacityUnits, horseOptionLabel, horseSerialNumber } from "@/lib/horsePicker";
import { currentYearMonth, formatYearMonth, monthLabel, parseYearMonth, shiftMonth } from "@/lib/monthlyReport";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import HorseReportFilters from "./HorseReportFilters";
import HorseReportForm from "./HorseReportForm";

export const dynamic = "force-dynamic";

type Horse = {
  id: string;
  name: string;
  profile: string | null;
  image_url: string | null;
  created_at: string;
  is_supportable: boolean;
  sort_order: number;
};
type Saved = { staff_note: string | null; photo_urls: string[] | null; body: string | null; life_story: string | null; published_at: string | null };

export default async function HorseReportsPage({ searchParams }: { searchParams: { horse?: string; ym?: string } }) {
  await requireAdmin();
  const admin = createSupabaseAdminClient();
  const current = currentYearMonth();
  const ym = parseYearMonth(searchParams.ym ?? "") && (searchParams.ym ?? "") <= current ? searchParams.ym! : current;
  const months = Array.from({ length: 24 }, (_, index) => {
    const parsed = parseYearMonth(current)!;
    const point = shiftMonth(parsed.year, parsed.month, -index);
    return formatYearMonth(point.year, point.month);
  });
  const [{ data: horses }, { rows: supportRows }] = await Promise.all([
    admin.from("horses").select("id, name, profile, image_url, created_at, is_supportable, sort_order").order("sort_order"),
    fetchAllRows<{ horse_id: string; units: number; status: string; canceled_at: string | null }>((from, to) =>
      admin.from("support_subscriptions").select("horse_id, units, status, canceled_at").order("id").range(from, to),
    ),
  ]);
  const unitsByHorse = new Map<string, number>();
  const now = Date.now();
  for (const row of supportRows) {
    if (row.status === "incomplete") continue;
    if (row.canceled_at && new Date(row.canceled_at).getTime() <= now) continue;
    unitsByHorse.set(row.horse_id, (unitsByHorse.get(row.horse_id) ?? 0) + (Number(row.units) || 0));
  }
  const list = ((horses ?? []) as Horse[]).sort((a, b) =>
    compareHorsesByNumber({ name: a.name, sortOrder: a.sort_order }, { name: b.name, sortOrder: b.sort_order }),
  );
  const horseOptions = list.map((item) => {
    const number = horseSerialNumber(item.name);
    const currentUnits = unitsByHorse.get(item.id) ?? 0;
    const available = availableSupportUnits(horseCapacityUnits(item.name), currentUnits);
    const opening = available == null
      ? (item.is_supportable ? "募集中" : "募集停止")
      : `応募可能 ${formatUnits(available)}`;
    const numberText = number == null ? "" : String(number).padStart(2, "0");
    return {
      id: item.id,
      label: horseOptionLabel(item.name, opening),
      search: [item.name, numberText, number ?? "", opening, available ?? "", "応募可能頭数"].join(" "),
    };
  });
  const horse = list.find((item) => item.id === searchParams.horse) ?? list[0] ?? null;
  let saved: Saved | null = null;
  let tableMissing = false;
  let supporters: { id: string | null; name: string; stars: number; founding: boolean; units: number }[] = [];
  if (horse) {
    const report = await admin.from("horse_reports").select("staff_note, photo_urls, body, life_story, published_at").eq("horse_id", horse.id).eq("year_month", ym).maybeSingle();
    if (report.error && (report.error.code === "PGRST205" || report.error.code === "42P01" || /horse_reports/.test(report.error.message))) tableMissing = true;
    else saved = (report.data as Saved | null) ?? null;
    const supports = await admin.from("support_subscriptions").select("customer_id, units, started_at, canceled_at, status").eq("horse_id", horse.id);
    const active = (supports.data ?? []).filter((row) => row.status !== "incomplete" && (!row.canceled_at || new Date(row.canceled_at) > new Date()));
    const ids = [...new Set(active.map((row) => row.customer_id as string))];
    const customers = ids.length ? await admin.from("customers").select("id, full_name, joined_at").in("id", ids) : { data: [] };
    const names = new Map((customers.data ?? []).map((row) => [row.id as string, row]));
    supporters = active.map((row) => {
      const customer = names.get(row.customer_id as string);
      return {
        id: (row.customer_id as string) ?? null,
        name: (customer?.full_name as string) || "会員",
        stars: supportStars((customer?.joined_at as string | null) ?? null),
        founding: isFoundingSupporter(row.started_at as string, horse.created_at),
        units: Number(row.units) || 0,
      };
    }).sort((a, b) => Number(b.founding) - Number(a.founding) || b.stars - a.stars);
  }

  const reportPhotos = Array.isArray(saved?.photo_urls) ? saved.photo_urls : [];
  const totalUnits = supporters.reduce((sum, person) => sum + person.units, 0);

  return (
    <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
      <style>{`@media print { body * { visibility: hidden; } .horse-sheet, .horse-sheet * { visibility: visible; } .horse-sheet { position: absolute; left: 0; top: 0; width: 100%; background: white; } }`}</style>
      <div className="no-print">
        <h1 className="text-2xl font-bold">馬の報告</h1>
        <p className="mt-1 text-sm text-ink-soft">近況と写真を入れると、今月の報告と、保護から今までの文章を作れます。公開すると会員ページから読め、印刷してPDFにできます。紹介の公開面は <a className="text-brand underline" href="https://retouch.news/" target="_blank" rel="noreferrer">retouch.news</a> です。</p>
      </div>
      <HorseReportFilters
        months={months.map((choice) => ({ value: choice, label: monthLabel(choice) }))}
        horses={horseOptions}
        ym={ym}
        horseId={horse?.id ?? ""}
      />
      {tableMissing ? <p className="no-print rounded-lg bg-amber-50 px-3 py-2 text-sm">保存用のテーブルがまだありません。newhorse.sql を適用すると保存できます。</p> : null}
      {horse ? (
        <>
          <article className="horse-sheet card min-w-0">
            <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)]">
              <div className="min-w-0 space-y-3">
                {horse.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={horse.image_url} alt={horse.name} className="h-auto w-full rounded-xl bg-surface-soft object-contain" />
                ) : (
                  <div className="flex min-h-32 items-center justify-center rounded-xl bg-surface-soft text-sm text-ink-soft">写真はまだありません</div>
                )}
                {reportPhotos.map((url) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={url} src={url} alt="" className="h-auto w-full rounded-xl bg-surface-soft object-contain" />
                ))}
              </div>
              <div className="min-w-0 space-y-4">
                <div>
                  <h2 className="break-words text-xl font-bold">{horse.name}</h2>
                  <p className="mt-1 text-sm text-ink-soft">{monthLabel(ym)}</p>
                </div>
                {horse.profile ? <p className="whitespace-pre-wrap break-words text-sm text-ink-soft">{horse.profile}</p> : null}
                {saved?.body ? <p className="whitespace-pre-wrap break-words text-sm">{saved.body}</p> : <p className="text-sm text-ink-soft">まだ今月の文章はありません。</p>}
                {saved?.life_story ? (
                  <div>
                    <h3 className="font-bold">保護から今まで</h3>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{saved.life_story}</p>
                  </div>
                ) : null}
                <section className="no-print rounded-xl border border-surface-line bg-surface-soft p-3">
                  <h3 className="font-bold">支援者の継続マーク</h3>
                  <p className="mt-1 text-xs text-ink-mute">入会から6か月ごとに星が1つ増え、5つで止まります。馬の登録から60日以内に支援を始めた人には、特別支援者の印が付きます。</p>
                  {supporters.length === 0 ? <p className="mt-3 text-sm text-ink-soft">いま有効な一口支援はありません。</p> : (
                    <>
                      <p className="mt-3 text-sm font-medium">{supporters.length}名　合計{totalUnits}口</p>
                      <ul className="mt-2 max-h-80 divide-y divide-surface-line overflow-y-auto rounded-lg border border-surface-line bg-white">
                        {supporters.map((person, index) => (
                          <li key={`${person.id ?? person.name}-${index}`} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                            <span className="min-w-0 break-words">
                              {person.id ? (
                                <a href={`/admin/customers/${person.id}`} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2">{person.name}</a>
                              ) : person.name}
                              {person.founding ? <span className="ml-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">特別支援者</span> : null}
                            </span>
                            <span className="shrink-0 text-right leading-5">{person.units}口<br />{"★".repeat(person.stars)}{"☆".repeat(5 - person.stars)}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              </div>
            </div>
          </article>
          <div className="no-print">
            <HorseReportForm
              key={`${horse.id}-${ym}-${saved?.body ?? ""}`}
              horseId={horse.id}
              ym={ym}
              note={saved?.staff_note ?? ""}
              body={saved?.body ?? ""}
              lifeStory={saved?.life_story ?? ""}
              photos={Array.isArray(saved?.photo_urls) ? saved.photo_urls : []}
              publishedAt={saved?.published_at ?? null}
            />
          </div>
        </>
      ) : <p className="text-sm">馬が登録されていません。</p>}
    </div>
  );
}
