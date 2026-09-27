import Image from "next/image";
import Link from "next/link";
import bgMobileImage from "@/assets/images/bg-m.png";
import bgDesktopImage from "@/assets/images/bg.png";
import contactBgImage from "@/assets/images/contact.png";
import userImage from "@/assets/images/user.png";
import ponyImage from "@/assets/images/pony.png";
import featureMembersImage from "@/assets/images/feature-members.jpg";
import featureEventImage from "@/assets/images/feature-event.jpg";
import featureHorseImage from "@/assets/images/feature-horse.jpg";
import BottomRightPanel from "@/components/BottomRightPanel";
import ContactForm from "@/components/ContactForm";
import HomeHeroEffect from "@/components/HomeHeroEffect";
import HeroText from "@/components/HeroText";
import BusinessPrinciplesDeck from "@/components/BusinessPrinciplesDeck";
import NewsCarousel from "@/components/NewsCarousel";
import HorsesSupportSection from "@/components/HorsesSupportSection";
import PublicFooterNav from "@/components/PublicFooterNav";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";
import type { NewsItem } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const { data: newsItems } = await supabase
    .from("news")
    .select("*")
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(12)
    .then((r) => r, () => ({ data: null }));

  // ログイン済みの会員がTOPのCTAから再度「会員登録」「ログイン」を求められると、
  // 二重に新規登録してしまい不要な会員データが増えてしまう。会員の場合は
  // そのまま会員専用の支援ページ（一口支援／リタポ）へ直接遷移させる。
  const session = await getSession();
  const isMember = !!session?.customerId;
  const supportHref = isMember ? "/mypage/supports/new" : "/signup";
  const ponyHref = isMember ? "/mypage/rpt/new" : "/signup";

  return (
    <div className="flex flex-col min-h-0 flex-1 overflow-x-hidden max-w-full">
      <HomeHeroEffect />

      {/* ── HERO ── */}
      <section id="home-hero" className="relative isolate min-h-[calc(100vh-73px)] flex flex-col overflow-hidden">
        <Image
          src={bgMobileImage}
          alt="引退競走馬支援プロジェクト"
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 z-0 object-cover object-top md:hidden"
        />
        <Image
          src={bgDesktopImage}
          alt="引退競走馬支援プロジェクト"
          fill
          priority
          sizes="100vw"
          className="absolute inset-0 z-0 hidden object-cover object-[40%_100%] md:block"
        />
        {/* H1 — hero headline (primary SEO keyword target).
            背景画像は元の色のまま表示するため、暗いオーバーレイは外しています。
            可読性は各テキストの drop-shadow で確保。 */}
        <HeroText />

        <div className="relative z-30 flex items-end justify-center pb-8">
          <a href="#overview" aria-label="下へスクロール">
            <div className="hero-pulse w-12 h-12 rounded-full border-2 border-white/70 flex items-center justify-center hover:bg-white/15 transition-colors cursor-pointer">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M8 2v12M3 9l5 5 5-5" stroke="#2d6a4f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </a>
        </div>
      </section>

      {/* ── OVERVIEW ── */}
      <section id="overview" className="bg-white py-20 px-5">
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-brand font-bold tracking-[0.2em] text-xs sm:text-sm mb-3 font-sans">SYSTEM FEATURES</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-ink mb-3 font-serif">
            人と馬をつなぐ<br className="sm:hidden" />Retouch専用プラットフォーム
          </h2>
          <p className="text-[13px] sm:text-sm max-w-2xl mx-auto mb-4 leading-relaxed text-ink-soft">
            <span className="block whitespace-nowrap">ここから始まる、人と馬が支え合う未来。</span>
            <span className="block whitespace-nowrap">Retouchメンバー様の力で、馬たちに新たな役割を。</span>
          </p>
          <p className="text-ink-soft text-sm max-w-2xl mx-auto mb-12 leading-relaxed">
            Retouchは、支援者・スタッフ・馬たちをつなぎ、
            人と馬が支え合う未来を育むためのプラットフォームです。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                img: featureMembersImage.src,
                title: "会員様情報",
                desc: "会員情報や契約プラン、支援履歴を一元管理。いつでもご自身の支援状況を確認できます。",
              },
              {
                img: featureHorseImage.src,
                title: "支援馬管理",
                desc: "支援している馬や口数、支援履歴をわかりやすく表示。応援している馬たちの近況も簡単に確認できます。",
              },
              {
                img: "https://images.unsplash.com/photo-1556742031-c6961e8560b0?w=600&h=300&fit=crop",
                title: "決済管理",
                desc: "クレジットカード決済やサブスクリプション管理を安全・スムーズに。登録内容の変更も簡単に行えます。",
              },
              {
                img: featureEventImage.src,
                title: "イベント管理",
                desc: "見学会や馬とのふれあいイベントの申込みをアプリから簡単予約。参加履歴もまとめて確認できます。",
              },
              {
                img: "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=300&fit=crop",
                title: "分析・レポート",
                desc: "支援状況や資金の活用状況を見える化。皆様の支援がどのように馬たちの未来につながっているかをご確認いただけます。",
              },
              {
                img: "https://images.unsplash.com/photo-1596526131083-e8c633c948d2?w=600&h=300&fit=crop",
                title: "お知らせ・メッセージ",
                desc: "Retouchからの活動報告や重要なお知らせをリアルタイムで配信。大切な情報を確実にお届けします。",
              },
            ].map((f) => (
              <div
                key={f.title}
                className="flex flex-col bg-white border border-surface-line rounded-xl hover:shadow-lg transition-shadow cursor-default overflow-hidden"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.img} alt={f.title} className="w-full h-44 object-cover" />
                <div className="p-5 text-left">
                  <p className="font-bold text-base text-ink mb-2">{f.title}</p>
                  <p className="text-sm text-ink-soft leading-relaxed">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BUSINESS PRINCIPLES ── */}
      <section className="bg-surface-soft py-20 px-5">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-brand font-bold tracking-[0.2em] text-xs sm:text-sm mb-3">BUSINESS PRINCIPLES</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-ink mb-4 font-serif">事業方針</h2>
            <p className="text-ink-soft text-sm max-w-2xl mx-auto leading-relaxed">
              Retouch（リタッチ）は、引退競走馬に新たな役割と活躍の場を創出し、
              人と馬が支え合う社会の実現を目指しています。<br />
              そのために、テクノロジーと人とのつながりを活かした持続可能な支援の仕組みを構築し、
              以下の4つの方針を軸に事業を推進しています。
            </p>
          </div>
          <BusinessPrinciplesDeck />
        </div>
      </section>

      {/* ── USER PAGE PREVIEW ── */}
      <section className="bg-surface-soft py-20 px-5">
        <div className="max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="overflow-hidden rounded-xl shadow-2xl border border-surface-line">
              <Image src={userImage} alt="会員マイページ画面" className="w-full h-auto" />
            </div>
            <div>
              <p className="text-brand font-bold tracking-[0.2em] text-xs sm:text-sm mb-3 text-center lg:text-left">MEMBER PAGE</p>
              <h2 className="text-2xl sm:text-3xl font-bold text-ink mb-5 leading-snug font-serif text-center lg:text-left">会員は自分の支援を<br />いつでも確認・変更</h2>
              <ul className="space-y-3 text-ink-soft text-sm leading-relaxed">
                {[
                  "支援中の馬と口数をひとつの画面で確認",
                  "決済状況・次回請求日をリアルタイム表示",
                  "見学会・個別見学の予約をオンラインで完結",
                  "いつでも単発寄付が可能",
                  "住所・カード情報もセルフで変更できる",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center shrink-0">
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5 3.5-4" stroke="#2d6a4f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3 justify-center lg:justify-start">
                {isMember ? (
                  <>
                    <Link href="/mypage/supports/new" className="btn-primary btn-pulse">支援する</Link>
                    <Link href="/mypage" className="btn-secondary">マイページへ</Link>
                  </>
                ) : (
                  <>
                    <Link href="/signup" className="btn-primary btn-pulse">会員登録する</Link>
                    <Link href="/login" className="btn-secondary">ログイン</Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── RETOUCH PONY TEAM ── */}
      <section id="pony-team" className="relative overflow-hidden bg-gradient-to-br from-brand-50 via-white to-amber-50/50 py-20 px-5">
        <div aria-hidden className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-brand-100/40 blur-3xl" />
        <div aria-hidden className="absolute -bottom-20 -left-16 w-64 h-64 rounded-full bg-amber-100/40 blur-3xl" />

        <div className="relative max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
            {/* Photo with price badge */}
            <div className="relative order-1">
              <div className="overflow-hidden rounded-2xl shadow-2xl border border-white/70">
                <Image
                  src={ponyImage}
                  alt="ふれあい活動を行うRetouchポニーチームのポニーたち"
                  className="w-full h-[280px] sm:h-[380px] object-cover"
                />
              </div>
              <div className="absolute -bottom-5 right-4 sm:right-8 bg-white rounded-2xl shadow-xl px-5 py-3 border border-brand-100 text-center">
                <p className="text-[11px] text-ink-mute font-bold tracking-wider">月額支援</p>
                <p className="font-serif text-2xl sm:text-3xl font-bold text-brand-dark leading-none mt-0.5">
                  ¥3,000<span className="text-sm font-sans font-medium text-ink-soft"> / 月</span>
                </p>
              </div>
            </div>

            {/* Copy */}
            <div className="order-2">
              <p className="text-brand font-bold tracking-[0.2em] text-xs sm:text-sm mb-3">RETOUCH PONY TEAM</p>
              <h2 className="text-2xl sm:text-[1.9rem] font-bold text-ink mb-5 leading-snug font-serif">
                肥育場からやってきたポニーたちを、<br className="hidden sm:block" />みんなで支えませんか？
              </h2>
              <p className="text-ink-soft text-sm leading-relaxed mb-4">
                この子たちは、ただ保護されるだけの存在ではありません。イベントやふれあい活動を通じて、引退競走馬や肥育場にいる馬たちの現状を伝える、Retouchの大切な
                <span className="font-bold text-brand-dark">「広報部隊」</span>です。
              </p>
              <p className="text-ink font-serif text-base sm:text-lg font-bold mb-5 leading-relaxed">
                小さな体で、大きな役割を担うポニーたち。
              </p>
              <p className="text-ink-soft text-sm leading-relaxed mb-6">
                その毎日と未来を支えるため、月額3,000円の
                <span className="font-bold text-brand-dark">「Retouchポニーチーム支援メンバー」</span>
                を募集しています。あなたのご支援が、ポニーたちの暮らしを支え、そして多くの馬たちの未来につながります。
              </p>

              <p className="text-xs font-bold text-ink-mute tracking-wide mb-2">ご支援の使いみち</p>
              <ul className="flex flex-wrap gap-2 mb-7">
                {["飼育費", "医療費", "輸送・移動費", "イベント・広報活動費", "施設維持管理費"].map((t) => (
                  <li
                    key={t}
                    className="inline-flex items-center gap-1.5 bg-white/85 border border-brand-100 text-brand-dark text-xs font-bold px-3 py-1.5 rounded-full shadow-sm"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                      <path d="M2 5l2.5 2.5 3.5-4" stroke="#2d6a4f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {t}
                  </li>
                ))}
              </ul>

              {/* Mobile: stacked, centered, equal-width buttons. Desktop: inline row. */}
              <div className="flex flex-col items-center gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <Link href={ponyHref} className="btn-primary btn-pulse w-full max-w-xs sm:w-auto sm:max-w-none">ポニーチームを支援する</Link>
                <Link href="#contact" className="btn-secondary w-full max-w-xs sm:w-auto sm:max-w-none">活動について相談する</Link>
              </div>
              <p className="text-xs text-ink-mute mt-3 text-center sm:text-left">※ 他の会員プランと併用してご参加いただけます。</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="bg-[#faf9f6] py-24 sm:py-28 px-5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16 sm:mb-20">
            <p className="text-brand-dark/60 font-bold tracking-[0.25em] text-[11px] mb-5">HOW IT WORKS</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-ink font-serif leading-relaxed">
              支援を始める、<br className="sm:hidden" />3つのステップ
            </h2>
          </div>

          <div className="grid sm:grid-cols-3 gap-y-14 sm:gap-y-0">
            {[
              { step: "01", title: "登録する", body: "お名前とご住所だけで、すぐに。" },
              { step: "02", title: "支え方を選ぶ", body: "あなたに合った形で、無理なく。" },
              { step: "03", title: "馬とつながる", body: "いつでも見守り、変えられます。" },
            ].map((s, i) => (
              <div key={s.step} className="relative px-6 sm:px-10 text-center">
                {i > 0 && (
                  <div aria-hidden className="hidden sm:block absolute left-0 top-3 bottom-3 w-px bg-ink/10" />
                )}
                <p className="font-serif text-4xl sm:text-5xl text-brand-dark/25 mb-6 leading-none">{s.step}</p>
                <h3 className="text-lg font-bold text-ink mb-4 font-serif tracking-wide">{s.title}</h3>
                <p className="text-sm text-ink-soft leading-loose">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HORSES ── */}
      <HorsesSupportSection limit={6} showViewMore supportHref={supportHref} />

      {/* ── NEWS ── */}
      <section className="relative bg-surface-soft py-20 overflow-hidden">
        <div aria-hidden className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-brand-50 opacity-40 blur-3xl" />
        <div aria-hidden className="absolute -bottom-16 -left-16 w-56 h-56 rounded-full bg-brand-50 opacity-30 blur-3xl" />

        <div className="relative">
          <div className="px-5">
            <p className="text-brand font-bold tracking-[0.2em] text-xs sm:text-sm mb-3 text-center">NEWS</p>
            <h2 className="text-2xl sm:text-3xl font-bold text-ink mb-10 text-center font-serif">最新ニュース</h2>
          </div>
          <div className="px-5">
            <NewsCarousel items={(newsItems ?? []) as NewsItem[]} />
          </div>
        </div>
      </section>



      {/* ── FAQ ── */}
      <section className="relative bg-surface-soft py-20 px-5 overflow-hidden">
        <div aria-hidden className="absolute top-0 right-0 w-64 h-64 opacity-[0.04]">
          <svg viewBox="0 0 200 200" fill="#2d6a4f"><text x="20" y="160" fontSize="180" fontWeight="bold">?</text></svg>
        </div>

        <div className="relative max-w-3xl mx-auto">
          <p className="text-brand font-bold tracking-[0.2em] text-xs sm:text-sm mb-3 text-center">FAQ</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-ink mb-10 text-center font-serif">よくある質問</h2>

          <div className="space-y-3">
            {[
              { q: "Retouchとはどのような活動をしていますか？", a: "引退競走馬や肥育場にいる馬たちに新たな役割や活躍の場をつくり、人と馬が支え合う社会の実現を目指しています。" },
              { q: "なぜ馬を保護しているのですか？", a: "引退後の進路が見つからず、肥育場へ向かう馬たちがいます。Retouchでは、そのような馬たちに新しい役割や活躍の場をつくり、第二の人生を支える活動を行っています。" },
              { q: "肥育場とは何ですか？", a: "肥育場とは、食肉用として出荷される前の馬が集められる施設です。Retouchでは、その中から新たな未来をつくれる可能性のある馬たちを受け入れています。" },
              { q: "保護された馬たちはその後どうなりますか？", a: "乗馬、教育活動、観光、セラピー、ふれあい活動など、それぞれの個性に合った新しい役割を見つけ、人と関わりながら暮らしています。" },
              { q: "会員になるにはどうすればよいですか？", a: "会員登録ページよりお申し込みいただけます。スマートフォンやパソコンから簡単にお手続きいただけます。" },
              { q: "支援する馬は選べますか？", a: "はい。一口・半口支援では応援したい馬を選んでご支援いただけます。" },
              { q: "複数の馬を支援できますか？", a: "はい。複数頭への支援や追加支援も可能です。" },
              { q: "支援金はどのように使われますか？", a: "馬たちの飼育費、医療費、輸送費、施設維持費、教育活動費などに活用しています。" },
              { q: "支援した馬に会うことはできますか？", a: "はい。見学会や交流イベントを定期的に開催しております。詳細は会員ページやお知らせをご確認ください。" },
              { q: "馬たちの近況は知ることができますか？", a: "会員ページや活動報告、動画配信などを通じて定期的にお知らせしています。" },
              { q: "見学会やイベントには参加できますか？", a: "はい。会員向けイベントや一般参加可能なイベントを開催しております。アプリや会員ページからお申し込みいただけます。" },
              { q: "支援内容の変更や追加はできますか？", a: "はい。マイページから支援内容の確認・変更・追加支援のお手続きが可能です。" },
              { q: "支援を停止・退会したい場合はどうすればよいですか？", a: "マイページまたはお問い合わせフォームよりお手続きいただけます。" },
              { q: "企業や団体として支援することはできますか？", a: "はい。企業・団体様からのご支援や協賛も受け付けております。お気軽にお問い合わせください。" },
              { q: "ボランティアとして参加できますか？", a: "イベント運営や環境整備など、活動内容に応じて募集を行っています。募集情報はお知らせページをご確認ください。" },
              { q: "Retouchの目指す未来は何ですか？", a: "馬を「救う」だけでなく、一頭一頭に新たな役割をつくり、人と馬が支え合う社会を実現することです。皆様のご支援が、その未来を支える大きな力になっています。" },
            ].map((item) => (
              <details key={item.q} className="group bg-white shadow-sm rounded-xl overflow-hidden">
                <summary className="flex items-center justify-between gap-4 p-5 font-bold text-sm text-ink cursor-pointer hover:bg-brand-50/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 bg-brand-50 text-brand flex items-center justify-center text-xs font-bold shrink-0">Q</span>
                    <span>{item.q}</span>
                  </div>
                  <svg className="faq-chevron w-5 h-5 shrink-0 text-ink-mute" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </summary>
                <div className="px-5 pb-5 pt-0">
                  <div className="pl-10 text-sm text-ink-soft leading-relaxed border-t border-surface-line pt-4">{item.a}</div>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>


      {/* ── CONTACT ── */}
      <section id="contact" className="relative py-20 px-5 overflow-hidden">
        {/* Background image */}
        <Image
          src={contactBgImage}
          alt=""
          fill
          className="object-cover"
          priority={false}
        />
        <div className="absolute inset-0 bg-black/45" />

        <div className="relative max-w-5xl mx-auto">
          <p className="text-brand-light font-bold tracking-[0.2em] text-xs sm:text-sm mb-3 text-center drop-shadow-md">CONTACT</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-4 text-center font-serif drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)]">お問い合わせ</h2>
          <p className="text-white text-sm max-w-lg mx-auto mb-12 text-center leading-relaxed drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
            ご不明な点がございましたら、お気軽にお問い合わせください。
          </p>

          {/* Contact form */}
          <div className="card max-w-2xl mx-auto bg-white">
            <h3 className="font-bold text-lg text-brand-dark mb-5 flex items-center gap-2">
              <svg viewBox="0 0 20 20" className="w-5 h-5" fill="#2d6a4f"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" /><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" /></svg>
              お問い合わせフォーム
            </h3>
            <ContactForm />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-ink py-12 px-5">
        <div className="max-w-5xl mx-auto">
          {/* Company info + Google Map */}
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <address className="not-italic text-white/75 text-sm leading-relaxed space-y-1.5 text-center md:text-left">
              <Image
                src="/logo.png"
                alt="Retouch"
                width={200}
                height={58}
                className="h-11 w-auto mb-3 mx-auto md:mx-0"
              />
              <p className="font-bold text-white text-base mb-1">株式会社リタッチ</p>
              <p>事務局：〒586-0036</p>
              <p>大阪府河内長野市高向2001　ホースレスト内</p>
              <p>
                TEL：
                <a href="tel:050-6875-3336" className="underline hover:text-white">
                  050-6875-3336
                </a>
              </p>

              {/* ── SOCIAL LINKS ── 電話番号の下に配置。既定は白系、ホバーで各ブランドカラー。 */}
              <div className="flex items-center justify-center md:justify-start gap-5 pt-3">
                <a
                  href="https://www.instagram.com/retouch_horses/"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="Instagram"
                  className="text-white/80 transition-colors hover:text-[#E1306C]"
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
                    <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678c-3.405 0-6.162 2.76-6.162 6.162 0 3.405 2.76 6.162 6.162 6.162 3.405 0 6.162-2.76 6.162-6.162 0-3.405-2.76-6.162-6.162-6.162zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405c0 .795-.646 1.44-1.44 1.44-.795 0-1.44-.646-1.44-1.44 0-.794.646-1.439 1.44-1.439.793-.001 1.44.645 1.44 1.439z" />
                  </svg>
                </a>
                <a
                  href="https://x.com/retouch_menbers"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="X (Twitter)"
                  className="text-white/80 transition-colors hover:text-[#1DA1F2]"
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
                    <path d="M23.953 4.57a10 10 0 01-2.825.775 4.958 4.958 0 002.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 00-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 00-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 01-2.228-.616v.06a4.923 4.923 0 003.946 4.827 4.996 4.996 0 01-2.212.085 4.936 4.936 0 004.604 3.417 9.867 9.867 0 01-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 007.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0024 4.59z" />
                  </svg>
                </a>
                <a
                  href="https://www.youtube.com/@Retouch2023"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label="YouTube"
                  className="text-white/80 transition-colors hover:text-[#FF0000]"
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
                    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                  </svg>
                </a>
                <a
                  href="#contact"
                  aria-label="お問い合わせ"
                  className="text-white/80 transition-colors hover:text-brand-light"
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
                    <path d="M1.5 8.67v8.58a3 3 0 0 0 3 3h15a3 3 0 0 0 3-3V8.67l-8.928 5.493a3 3 0 0 1-3.144 0L1.5 8.67Z" />
                    <path d="M22.5 6.908V6.75a3 3 0 0 0-3-3h-15a3 3 0 0 0-3 3v.158l9.714 5.978a1.5 1.5 0 0 0 1.572 0L22.5 6.908Z" />
                  </svg>
                </a>
              </div>
            </address>

            <div className="overflow-hidden rounded-xl border border-white/10 shadow-lg">
              <iframe
                title="株式会社リタッチ 事務局（ホースレスト）所在地"
                src={`https://maps.google.com/maps?q=${encodeURIComponent(
                  "大阪府河内長野市高向2001 ホースレスト",
                )}&z=15&hl=ja&output=embed`}
                width="100%"
                height={240}
                style={{ border: 0 }}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
                className="block w-full"
              />
            </div>
          </div>

          <div className="border-t border-white/10 mt-10 pt-8">
            <PublicFooterNav
              className="text-white/75"
              linkClassName="text-white/75 hover:text-white underline-offset-2 hover:underline"
            />
          </div>

          <p className="text-white/40 text-xs text-center mt-8">© 2026 引退競走馬支援プロジェクト</p>
        </div>
      </footer>

      {/* Bottom padding for mobile CTA bar + floating controls */}
      <div className="h-20 md:hidden" aria-hidden />

      <BottomRightPanel />
    </div>
  );
}
