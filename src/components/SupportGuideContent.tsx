import Link from "next/link";

type Props = {
  showSignupCta?: boolean;
};

export default function SupportGuideContent({ showSignupCta = false }: Props) {
  return (
    <article className="space-y-8">
      <header className="text-center space-y-3">
        <p className="text-brand font-bold tracking-[0.12em] text-xs">HORSE SUPPORT PROGRAM</p>
        <p className="text-lg sm:text-xl font-bold text-ink font-serif leading-snug">
          みんなで守ろう、引退競走馬の未来
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-brand font-serif">
          Retouch馬 1口支援制度のご案内
        </h1>
      </header>

      <section className="card space-y-4 text-sm sm:text-base text-ink-soft leading-relaxed">
        <p>
          年間多くの競走馬が引退後の行き場を失っています。Retouchでは、肥育場へ送られる予定だった馬たちを引き取り、新しい人生を歩めるよう再調教（リトレーニング）を行い、乗馬・教育・観光・福祉など様々な分野で活躍できる環境づくりに取り組んでいます。
        </p>
        <p>
          皆さまのご支援により、現在までに多数の引退競走馬たちを肥育場から保護することができました。しかし、保護された馬たちの中には、新しいオーナー様が見つかるだけでなく、「このままRetouchで幸せに暮らしてほしい」という声をいただく馬たちもいます。
        </p>
        <p>
          そこでRetouchでは、『1口支援制度』を設け、皆さまと一緒に馬たちの生涯を支えていく仕組みをスタートいたしました。
        </p>
      </section>

      <section className="card space-y-4 border-2 border-brand/20 bg-brand-50/30">
        <h2 className="section-title mb-0">1口支援とは</h2>
        <p className="text-sm sm:text-base text-ink leading-relaxed font-semibold">
          「1口　月額12,000円」
        </p>
        <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
          馬1頭をRetouchで継続して管理するためには、最低8口（96,000円／月）のご支援が必要となります。
        </p>
        <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
          8口以上の支援が集まった馬は、Retouchが所有・管理を継続し、外部への譲渡対象から外れます。
        </p>
        <p className="text-sm sm:text-base text-ink font-medium">
          皆さまのご支援が、その馬の未来を守る力になります。
        </p>
      </section>

      <section className="card space-y-4">
        <h2 className="section-title mb-0">支援特典</h2>
        <div className="space-y-4 text-sm sm:text-base text-ink-soft leading-relaxed">
          <div className="border-l-4 border-brand pl-4">
            <p className="font-bold text-ink mb-1">1口支援　月1回（要予約）</p>
            <p>支援馬との面会・ふれあい（約30分）</p>
          </div>
          <div className="border-l-4 border-brand pl-4">
            <p className="font-bold text-ink mb-1">2口支援</p>
            <p>
              1口特典に加え、ご来場時に約30分間の放牧タイムをご用意いたします。馬とのふれあいを楽しみながら、自然な姿をご覧いただけます。
            </p>
          </div>
          <div className="rounded-xl bg-surface-soft border border-surface-line p-4">
            <p className="font-bold text-ink mb-1">※半口支援について</p>
            <p>
              リタッチの一口支援では、半口支援制度も受け付けております。半口支援制度では6000円／月額となり、2ヶ月に1回の割合での面会が可能です。
            </p>
          </div>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="section-title mb-0">ご確認いただきたい事項</h2>
        <ul className="space-y-4 text-sm sm:text-base text-ink-soft leading-relaxed">
          <li>
            <p className="font-bold text-ink mb-1">■ 8口未満の馬について</p>
            <p>
              8口に達していない馬については、里親オーナー様が見つかった場合、支援者様への個別確認なく譲渡となる場合があります。
            </p>
          </li>
          <li>
            <p className="font-bold text-ink mb-1">■ 8口達成馬について</p>
            <p>
              8口以上の支援を維持できている馬は、Retouch管理馬として継続飼養を行います。現在の支援口数は各馬の紹介ページにて公開いたします。
            </p>
          </li>
          <li>
            <p className="font-bold text-ink mb-1">■ お名前の掲載について</p>
            <p>
              支援者様のお名前（ニックネーム可）を、・厩舎前ホースボード・ホームページ内馬紹介ページへ掲載させていただきます。
            </p>
          </li>
          <li>
            <p className="font-bold text-ink mb-1">■ 所有権について</p>
            <p>馬の所有権は100％Retouchに帰属します。</p>
          </li>
          <li>
            <p className="font-bold text-ink mb-1">■ 万が一の場合</p>
            <p>
              生き物である以上、・病気・事故・加齢・予後不良などが発生する場合があります。死亡または予後不良となった場合は、その馬の1口支援制度を終了させていただきます。
            </p>
          </li>
        </ul>
      </section>

      <section className="card space-y-3">
        <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
          支援開始より、毎月自動決済により継続支援となります。あなたの1口が、馬たちの未来を守ります。
        </p>
        <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
          引退競走馬たちは、競馬を終えた瞬間に価値を失う存在ではありません。教育、福祉、観光、乗馬。新しい役割を持つことで、再び人を支え、社会に貢献することができます。
        </p>
        <p className="text-sm sm:text-base text-ink font-medium leading-relaxed">
          ぜひ、あなたもRetouch馬たちの未来づくりにご参加ください。
        </p>
      </section>

      {showSignupCta && (
        <footer className="text-center space-y-4 pt-2">
          <div className="flex flex-col items-center gap-3">
            <Link href="/signup" className="btn-primary btn-pulse px-8 py-3 text-base">
              上記を承認のうえ支援を始める
            </Link>
            <Link href="/guide" className="btn-secondary text-sm">
              ご入会のご案内を読む
            </Link>
          </div>
        </footer>
      )}
    </article>
  );
}
