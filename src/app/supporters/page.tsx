import type { Metadata } from "next";
import Link from "next/link";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/fetchAll";
import PublicFooterNav from "@/components/PublicFooterNav";

export const metadata: Metadata = {
  title: "支援者のみなさま",
  description:
    "Retouch（リタッチ）を支えてくださっている、リタポ（RetouchPony）支援者・特別チーム支援者のみなさまのニックネーム一覧です。",
  alternates: { canonical: "/supporters" },
};

// 一般公開ページ（ログイン不要）。プライバシー配慮のため、ニックネーム（カナ）
// のみを表示し、氏名・金額・メール等は一切表示しない。
export const dynamic = "force-dynamic";

type NickGroup = { label: string; nicknames: string[] };

function uniqSortedKana(values: (string | null | undefined)[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const n = (v ?? "").trim();
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ja"));
}

export default async function SupportersPage() {
  const admin = createSupabaseAdminClient();

  // 掲載する支援者は全件が前提。素のクエリは PostgREST の 1000 行上限で
  // 黙って打ち切られ、支援者が公開ページから漏れるためページングする。
  const [{ rows: rptContracts }, { rows: teamRows }] = await Promise.all([
    // リタポ（RPT）支援者：有効な RPT 契約の会員。
    fetchAllRows<any>((from, to) =>
      admin
        .from("contracts")
        .select("id, status, customer:customers(full_name_kana), plan:membership_plans(code)")
        .eq("status", "active")
        .order("id", { ascending: true })
        .range(from, to),
    ),
    // 特別チーム支援者（¥1,000）：有効な special_team_memberships。
    fetchAllRows<any>((from, to) =>
      admin
        .from("special_team_memberships")
        .select("id, status, team_name, customer:customers(full_name_kana), horse:horses(name)")
        .in("status", ["active", "past_due"])
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  // リタポ
  const rptNicknames = uniqSortedKana(
    rptContracts
      .filter((c) => c.plan?.code === "RPT")
      .map((c) => c.customer?.full_name_kana),
  );

  // 特別チーム：チームごとにまとめる（team_name 未設定なら馬名で代替）。
  const byTeam = new Map<string, (string | null)[]>();
  for (const r of teamRows) {
    const label = (r.team_name?.trim() || r.horse?.name?.trim() || "特別チーム") as string;
    const arr = byTeam.get(label) ?? [];
    arr.push(r.customer?.full_name_kana ?? null);
    byTeam.set(label, arr);
  }
  const teamGroups: NickGroup[] = [...byTeam.entries()]
    .map(([label, names]) => ({ label, nicknames: uniqSortedKana(names) }))
    .filter((g) => g.nicknames.length > 0)
    .sort((a, b) => b.nicknames.length - a.nicknames.length);

  const hasAny = rptNicknames.length > 0 || teamGroups.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <main className="flex-1">
        <div className="max-w-5xl mx-auto px-5 pt-8">
          <Link href="/" className="text-brand underline text-sm">
            ← トップページへ
          </Link>
        </div>

        <section className="bg-[#faf9f6] py-16 px-5">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-brand font-bold tracking-[0.2em] text-xs sm:text-sm mb-3">OUR SUPPORTERS</p>
              <h1 className="text-2xl sm:text-3xl font-bold text-ink mb-4 font-serif">支援者のみなさま</h1>
              <p className="text-ink-soft text-sm max-w-2xl mx-auto leading-relaxed">
                Retouch（リタッチ）の活動を支えてくださっている、
                <br className="hidden sm:block" />
                リタポ・特別チームの支援者のみなさまです。いつもありがとうございます。
              </p>
              <p className="text-ink-mute text-xs mt-3">※ニックネーム（カナ）のみを掲載しています。</p>
            </div>

            {!hasAny && (
              <p className="text-center text-ink-mute py-10">現在表示できる支援者情報がありません。</p>
            )}

            {/* リタポ */}
            {rptNicknames.length > 0 && (
              <div className="card mb-6">
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="section-title mb-0">リタポ（RetouchPony）支援者</h2>
                  <span className="text-xs text-ink-soft">{rptNicknames.length}名</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {rptNicknames.map((name, i) => (
                    <span
                      key={i}
                      className="text-[13px] bg-brand-50 text-brand-dark border border-brand-100 px-2.5 py-1 rounded-full"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 特別チーム */}
            {teamGroups.map((g) => (
              <div className="card mb-6" key={g.label}>
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="section-title mb-0">{g.label}</h2>
                  <span className="text-xs text-ink-soft">{g.nicknames.length}名</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {g.nicknames.map((name, i) => (
                    <span
                      key={i}
                      className="text-[13px] bg-brand-50 text-brand-dark border border-brand-100 px-2.5 py-1 rounded-full"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            ))}

            <div className="mt-10 text-center space-y-3">
              <p className="text-ink-soft text-sm">あなたの応援が、馬たちの毎日を支えます。</p>
              <div className="flex flex-wrap justify-center gap-3">
                <Link href="/signup" className="btn-primary btn-pulse">
                  支援を始める
                </Link>
                <Link href="/support-guide" className="btn-secondary">
                  1口支援制度のご案内
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-ink py-8 px-5">
        <div className="max-w-3xl mx-auto space-y-4">
          <PublicFooterNav className="text-white/75" linkClassName="hover:text-white underline-offset-2" />
          <p className="text-white/40 text-xs text-center">© 2026 引退競走馬支援プロジェクト</p>
        </div>
      </footer>
    </div>
  );
}
