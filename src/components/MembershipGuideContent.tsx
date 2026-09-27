import Link from "next/link";

type Props = {
  /** ページ末尾に会員登録ボタンを表示 */
  showSignupCta?: boolean;
};

export default function MembershipGuideContent({ showSignupCta = false }: Props) {
  return (
    <article className="space-y-8">
      <header className="text-center space-y-3">
        <p className="text-brand font-bold tracking-[0.15em] text-xs">MEMBERSHIP GUIDE</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-ink font-serif leading-snug">
          Retouch（リタッチ）
          <br />
          ご入会のご案内
        </h1>
        <p className="text-sm text-ink-soft leading-relaxed">
          メンバーズ会員・サポーター会員
          <br />
          リェリーフ会員・RetouchPony（リタポ）メンバー
        </p>
      </header>

      {/* ── 冒頭文 ── */}
      <section className="card space-y-4 leading-relaxed text-sm sm:text-base text-ink-soft">
        <p>
          この度は、Retouchの活動にご関心をお寄せいただき、誠にありがとうございます。
        </p>
        <p>
          初回は無料で仮登録が可能です。内容をご確認のうえ、毎月末までに以下いずれかのプランへご登録をお願いいたします。
        </p>
        <ul className="space-y-1 pl-4 list-disc text-ink">
          <li>メンバーズ会員　月額 1,800円</li>
          <li>サポーター会員　月額 3,600円</li>
          <li>リェリーフ会員　月額 7,200円</li>
          <li>RetouchPony（リタポ）メンバー　月額 3,000円</li>
        </ul>
        <ul className="space-y-1 pl-4 list-disc text-ink">
          <li>半口支援　月額 6,000円</li>
          <li>一口支援　月額 12,000円</li>
        </ul>
        <p>
          なお、毎月末までに本登録が確認できない場合は、仮登録情報を自動的に削除させていただきます。
          以下の内容をご確認のうえ、ページ下部の「上記を承認のうえ会員登録する」よりお手続きください。
          よろしくお願いいたします。
        </p>
      </section>

      {/* ── 会員制度について ── */}
      <section className="card space-y-4">
        <h2 className="section-title mb-0">会員制度について</h2>
        <p className="text-sm text-ink-soft leading-relaxed">
          Retouchでは、継続的に活動を支えていただくための会員制度を設けております。
        </p>
        <ul className="space-y-2 text-sm sm:text-base">
          <li className="flex justify-between gap-4 border-b border-surface-line pb-2">
            <span className="font-semibold text-ink">メンバーズ会員</span>
            <span className="text-ink-soft whitespace-nowrap">月額 1,800円</span>
          </li>
          <li className="flex justify-between gap-4 border-b border-surface-line pb-2">
            <span className="font-semibold text-ink">サポーター会員</span>
            <span className="text-ink-soft whitespace-nowrap">月額 3,600円</span>
          </li>
          <li className="flex justify-between gap-4 border-b border-surface-line pb-2">
            <span className="font-semibold text-ink">リェリーフ会員</span>
            <span className="text-ink-soft whitespace-nowrap">月額 7,200円</span>
          </li>
          <li className="flex justify-between gap-4 border-b border-surface-line pb-2">
            <span className="font-semibold text-ink">RetouchPony（リタポ）メンバー</span>
            <span className="text-ink-soft whitespace-nowrap">月額 3,000円</span>
          </li>
        </ul>
        <p className="text-sm text-ink-soft leading-relaxed">
          ※会員種別による特典の違いはありません。ご無理のない範囲でお選びください。また、特定の馬を支援する
          <Link href="/support-guide" className="text-brand underline mx-1">
            「1口支援馬会員制度」
          </Link>
          （月額6,000円〜12,000円）もご用意しております。
        </p>
      </section>

      {/* ── 会員特典 ── */}
      <section className="card space-y-4">
        <h2 className="section-title mb-0">会員特典</h2>
        <div className="space-y-4 text-sm sm:text-base text-ink-soft leading-relaxed">
          <div>
            <p className="font-bold text-ink mb-1">① 見学会・懇談会への参加</p>
            <p>
              大阪・千葉のRetouch施設にて、年9回程度の見学会・懇談会を開催しております。
              <span className="text-ink-mute">※参加費2,000円</span>
            </p>
          </div>
          <div>
            <p className="font-bold text-ink mb-1">② 会員限定情報の配信</p>
            <p>
              活動報告、保護頭数、会員数、支援金の使途、今後の計画などを会員限定でお知らせいたします。
            </p>
          </div>
        </div>
      </section>

      {/* ── 会費の使い道 ── */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">会費の使い道</h2>
        <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
          皆さまからいただいた会費は、「約20％：運営費・事務費」「約80％：馬の支援活動費」として活用しております。
        </p>
        <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
          支援活動費には、①馬の購入費　②輸送諸経費　③飼育費　④医療費などが含まれます。また、毎年12月末までの収支について、翌年3月末までに会員の皆さまへご報告いたします。
        </p>
      </section>

      {/* ── 馬を受け入れるために必要な費用 ── */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">馬を受け入れるために必要な費用</h2>
        <ul className="text-sm sm:text-base text-ink-soft leading-relaxed space-y-2 list-none">
          <li>肥育場からの購入費　約80万円（税別）／1頭</li>
          <li>引き取りに伴う費用　最大12万円程度／1頭（下見・輸送・交通費等を含む）</li>
          <li>
            月々の馬の管理経費　約6万円（税別）／1頭
            <br />
            <span className="text-xs text-ink-mute">
              ※（飼料費・敷料費・獣医費・装蹄費等を含む）※人件費・場所代を含まない
            </span>
          </li>
        </ul>
      </section>

      {/* ── Retouch馬の管理について ── */}
      <section className="card space-y-3">
        <h2 className="section-title mb-0">Retouch馬の管理について</h2>
        <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
          保護した馬たちは、千葉県「八街市」・「山武市」大阪府「河内長野市」の施設にて管理・リトレーニングを行っています。新たなオーナー様が見つかった場合は、譲渡を行い、その収益は次の馬を救うための資金として活用いたします。
        </p>
      </section>

      {/* ── 免責事項 ── */}
      <section className="card space-y-3 border-2 border-surface-line bg-surface-soft/50">
        <h2 className="section-title mb-0">免責事項</h2>
        <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
          Retouchは、1頭でも多くの行き場を失った馬たちを救いたいという想いで活動しております。しかし、生き物である以上、病気、怪我、事故、加齢、安楽死の判断などを避けることができない場合があります。また本活動は、馬の生涯を完全に保証するものではありません。
        </p>
        <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
          それでも私たちは、「できるだけ長く」「できるだけ幸せに」「できるだけ一生涯を共に」という想いを胸に、馬たちと向き合い続けています。その現実と理念をご理解いただいたうえで、ご支援いただけますと幸いです。
        </p>
      </section>

      <footer className="text-center space-y-4 pt-2">
        <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
          皆さまのお力が、次の1頭を救う力になります。
        </p>
        <p className="font-serif font-bold text-ink">
          Retouch
          <br />
          <span className="text-sm font-normal text-ink-soft">代表　野口 佳槻</span>
        </p>
        {showSignupCta && (
          <div className="flex flex-col items-center gap-3 pt-2">
            <Link href="/signup" className="btn-primary btn-pulse px-8 py-3 text-base">
              上記を承認のうえ会員登録する
            </Link>
            <Link href="/login" className="btn-secondary text-sm">
              すでに登録済みの方はこちら（ログイン）
            </Link>
          </div>
        )}
      </footer>
    </article>
  );
}
