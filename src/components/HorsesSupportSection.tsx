import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { compareHorsesForDisplay, isEmergencyRecruitmentHorse } from "@/lib/horses";
import { fetchAllRows } from "@/lib/fetchAll";
import HorsesSupportGrid, { type HorseCardData } from "@/components/HorsesSupportGrid";

type HorseRow = {
  id: string;
  name: string;
  profile: string | null;
  image_url: string | null;
  is_supportable: boolean;
  is_emergency_recruitment?: boolean;
  sort_order: number;
};
type SupportInfo = {
  totalUnits: number;
  supporters: number;
  nicknames: string[];
};

type Props = {
  /** 表示件数（省略時は全件） */
  limit?: number;
  /** 一覧ページへの「View More」リンクを表示 */
  showViewMore?: boolean;
  /**
   * 「支援を始める」ボタンのリンク先。会員はログイン済みのため再登録を経ず
   * 会員専用の支援ページへ直接遷移させたい場合に指定する（既定は新規登録）。
   */
  supportHref?: string;
};

export default async function HorsesSupportSection({
  limit,
  showViewMore = false,
  supportHref = "/signup",
}: Props = {}) {
  const admin = createSupabaseAdminClient();

  // ユーザーのログイン状態を確認（getSession() は React cache() でリクエスト単位に
  // 共有されるため、ヘッダー等と合わせて重複した Supabase 認証呼び出しを避けられる）
  const session = await getSession();
  const isLoggedIn = !!session;

  // 支援口数・支援者数は全件を合計する必要がある。素のクエリは PostgREST の
  // 1000 行上限で黙って打ち切られ、公開ページの口数が過少表示になるためページングする。
  const [{ data: horses }, { rows: supporters }] = await Promise.all([
    admin
      .from("horses")
      // is_emergency_recruitment は必ず取得すること。取得しないと
      // isEmergencyRecruitmentHorse() が undefined を見て常に false となり、
      // 管理画面で「緊急募集」にしてもトップ／馬一覧でピンク表示・上段固定に
      // ならない（馬名に「緊急支援募集馬」を含む場合だけ偶然動いていた）。
      .select("id, name, profile, image_url, is_supportable, is_emergency_recruitment, sort_order")
      .order("sort_order"),
    fetchAllRows<any>((from, to) =>
      admin
        .from("support_subscriptions")
        .select("horse_id, units, customer:customers(full_name_kana)")
        .in("status", ["active", "past_due"])
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  if (!horses || horses.length === 0) return null;

  // Build per-horse support info
  const byHorse = new Map<string, SupportInfo>();
  for (const s of supporters) {
    const cur = byHorse.get(s.horse_id) ?? { totalUnits: 0, supporters: 0, nicknames: [] };
    cur.totalUnits += Number(s.units);
    cur.supporters += 1;
    const nick = ((s.customer as any)?.full_name_kana as string | null)?.trim();
    if (nick) cur.nicknames.push(nick);
    byHorse.set(s.horse_id, cur);
  }

  const sorted = [...(horses as HorseRow[])].sort((a, b) =>
    compareHorsesForDisplay(a, b, (id) => byHorse.get(id)?.totalUnits ?? 0),
  );

  const displayed = limit != null ? sorted.slice(0, limit) : sorted;
  const hasMore = limit != null && sorted.length > limit;

  const cards: HorseCardData[] = displayed.map((horse) => {
    const info = byHorse.get(horse.id);
    return {
      id: horse.id,
      name: horse.name,
      profile: horse.profile,
      imageUrl: horse.image_url,
      isSupportable: horse.is_supportable,
      emergency: isEmergencyRecruitmentHorse(horse),
      totalUnits: info?.totalUnits ?? 0,
      supporters: info?.supporters ?? 0,
      nicknames: info?.nicknames ?? [],
      supportHref: isLoggedIn
        ? `/mypage/supports/new?horse_id=${horse.id}`
        : `/signup?horse_id=${horse.id}`,
    };
  });

  return (
    // scroll-margin: sticky ヘッダー（約 73px）の下に収まるよう余白を確保し、
    // アンカー遷移やスクロール時に先頭カードが欠けないようにする。
    <section id="horses" className="scroll-mt-[88px] bg-[#faf9f6] py-16 sm:py-20 px-5">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10 sm:mb-12">
          <p className="text-brand font-bold tracking-[0.2em] text-xs sm:text-sm mb-3">OUR HORSES</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-ink mb-4 font-serif">馬ごとの支援状況</h2>
          <p className="text-ink-soft text-sm max-w-2xl mx-auto leading-relaxed">
            支援の多い馬から順に並んでいます。<br />
            カードをタップすると詳細を確認できます。気になった馬をぜひ応援してください。
          </p>
        </div>

        <HorsesSupportGrid horses={cards} />

        <div className="mt-10 text-center space-y-3">
          {showViewMore && hasMore && (
            <a
              href="/horses"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary inline-flex"
            >
              View More
            </a>
          )}
          <p className="text-ink-soft text-sm">あなたの応援が、馬たちの毎日を支えます。</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link href={isLoggedIn ? "/mypage/supports/new" : supportHref} className="btn-primary btn-pulse">
              支援を始める
            </Link>
            <Link href="/support-guide" className="btn-secondary">
              1口支援制度のご案内
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
