import Image from "next/image";
import Link from "next/link";
import horseImage from "@/assets/images/horse.png";
import { requireMember } from "@/lib/auth";
import RoleBadge from "@/components/RoleBadge";
import { resolveBadge, nextBadgeHint } from "@/lib/roles";
import { loadPaymentStat } from "@/lib/badge";
import {
  loadActiveContract,
  loadActiveSpecialTeam,
  loadActiveSupports,
  loadCustomer,
  loadCustomerSummary,
  loadPayments,
} from "@/lib/customer";
import SpecialTeamStopButton from "./SpecialTeamStopButton";
import CommunityMypageCard from "@/components/community/CommunityMypageCard";
import { canSeeCommunity } from "@/lib/community/visibility";
import { MEMBER_SELF_SERVICE_ENABLED, MEMBER_PLAN_SELF_SERVICE_ENABLED } from "@/lib/featureFlags";
import { formatDate, formatUnits, formatYen, memberClassLabel } from "@/lib/format";
import { isBasicMemberPlanCode } from "@/lib/constraints";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  describePaymentDisplay,
  fromContractStatus,
} from "@/lib/paymentStatus";

export default async function MyPageTop() {
  const session = await requireMember();
  if (!session.customerId) {
    return (
      <div className="card">
        <p className="text-danger font-semibold mb-2">会員情報が見つかりません。</p>
        <p className="text-sm text-ink-soft">運営へお問い合わせください。</p>
      </div>
    );
  }

  const customerId = session.customerId;
  const [customer, summary, contract, supports, recentPayments, specialTeams] = await Promise.all([
    loadCustomer(customerId),
    loadCustomerSummary(customerId),
    loadActiveContract(customerId),
    loadActiveSupports(customerId),
    loadPayments(customerId, 5),
    loadActiveSpecialTeam(customerId),
  ]);

  const baseStatusKey = contract
    ? fromContractStatus(contract.status)
    : supports.length > 0
      ? fromContractStatus(supports[0].status)
      : "stopped";

  const recentlyRecovered =
    baseStatusKey === "ok" &&
    recentPayments.some((p) => p.status === "failed") &&
    recentPayments[0]?.status === "succeeded";

  const now = Date.now();
  const scheduledStop = supports
    .filter((s) => s.status === "active" && s.canceled_at)
    .map((s) => ({
      id: s.id,
      name: s.horse?.name ?? "—",
      date: s.canceled_at as string,
    }))
    .filter((s) => new Date(s.date).getTime() > now)
    .sort((a, b) => a.date.localeCompare(b.date));

  const displayKey =
    scheduledStop.length > 0 && baseStatusKey === "ok"
      ? "in_progress"
      : baseStatusKey;

  const display = describePaymentDisplay(displayKey, {
    recentlyRecovered,
    scheduledCancelAt: scheduledStop[0]?.date ?? null,
  });

  const supabase = createSupabaseServerClient();
  const { count: bookingCount } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("status", "reserved");

  const supportMonthlyTotal = supports.reduce(
    (sum, s) => sum + Number(s.monthly_amount ?? 0),
    0
  );
  // 月額合計に加算するのは基本会員区分(A/B/C)の月額のみ。
  // ・ヘルパーズ(SUPPORT)契約は「1口支援馬会員」の区分マーカーであり、実際の課金額は
  //   support_subscriptions（馬ごとの支援額）に計上済み。これを足すと二重計上になる
  //   （ヘルパーズ会員でマイページの月額がちょうど12,000円多く表示されていた原因）。
  // ・リタポ(RPT)・特別チーム(SPECIAL_TEAM)は「特別参加」として別タグで表示する追加項目で、
  //   管理画面の月額合計(v_customer_summary.monthly_total)にも含めていない。
  // → これによりマイページと管理画面の月額合計を一致させる。
  const basicMonthly =
    contract?.plan && isBasicMemberPlanCode(contract.plan.code)
      ? Number(contract.plan.monthly_amount ?? 0)
      : 0;
  const monthlyGrandTotal = supportMonthlyTotal + basicMonthly;

  // Tenure/payment-based badge (bronze: 登録2か月+ / silver: 支払い6か月+ /
  // gold: 6か月+ かつ 累計¥100,000+ または リタポ保有)。
  const payStat = await loadPaymentStat(supabase, customerId);
  const badgeStats = {
    registeredAt: customer?.joined_at ?? customer?.created_at ?? null,
    firstPaymentAt: payStat.firstPaymentAt,
    totalPaidYen: payStat.totalPaidYen,
    hasActiveRpt: session.hasActiveRpt,
  };
  const memberBadge = resolveBadge(session.role, badgeStats);
  // 次のバッジまでのヒント（スタッフ＝王冠には表示しない）。
  const nextBadgeText = memberBadge.kind === "full" ? null : nextBadgeHint(badgeStats);

  // 会員種別は大分類のみ（サポーター/メンバーズ/リェリーフ/ヘルパーズ）。
  // リタポ・特別チームは「特別参加」として別タグで表示し、会員種別には混ぜない。
  const hasSpecial = Boolean(summary?.rpt_active) || (summary?.special_team_count ?? 0) > 0;
  const specialTeamNames: string[] = Array.isArray(summary?.special_team_names)
    ? (summary?.special_team_names as string[])
    : [];
  // 表示は実プラン名(primary_plan_name)を優先する。アテンダー会員などは基本会員コード
  // 「A」を流用しているため、memberClassLabel("A") だと「メンバーズ会員」と誤表示される。
  // 管理画面（顧客一覧・詳細）と同じく primary_plan_name を優先し、無い場合のみ
  // コード由来のラベル（ヘルパーズ会員=SUPPORT 等）にフォールバックして表示を一致させる。
  const planBadgeText = summary?.primary_plan_name
    ? summary.primary_plan_name
    : summary?.member_class_code
    ? memberClassLabel(summary.member_class_code)
    : hasSpecial
    ? "—"
    : "未加入";

  // アテンダー会員は年内30,000円以上寄付で当年12/31まで有効。
  // planBadgeText（= primary_plan_name 優先）で判定し、有効期限を動的に表示する。
  const isAttenderMember = planBadgeText.includes("アテンダー");
  const attenderExpiryYear = new Date().getFullYear();
  const attenderExpiryText = `${attenderExpiryYear}年12月31日`;

  // Status indicator styling
  const statusBannerColor =
    displayKey === "ok" || displayKey === "in_progress"
      ? "from-brand to-brand-dark"
      : displayKey === "failed"
      ? "from-red-700 to-red-900"
      : "from-gray-600 to-gray-800";

  return (
    <div className="space-y-5">

      {/* ── Hero status banner ── */}
      <section className={`card bg-gradient-to-br ${statusBannerColor} text-white overflow-hidden relative`}>
        {/* Background pattern */}
        <div aria-hidden className="absolute inset-0 opacity-10">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="absolute select-none w-16 h-16 rounded-full overflow-hidden"
              style={{ right: `${i * 30 + 10}px`, top: `${i * 10 - 10}px`, transform: `rotate(${i * 15}deg)` }}
            >
              {/* 装飾用の小さな画像。fill+sizes未指定だと最適化APIが巨大サイズを要求して失敗しうる */}
              <Image src={horseImage} alt="" width={64} height={64} className="w-full h-full object-cover" />
            </span>
          ))}
        </div>

        <div className="relative">
          <p className="text-sm opacity-80">こんにちは</p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <h1 className="text-2xl font-bold">{customer?.full_name ?? "会員"}様</h1>
            <RoleBadge badge={memberBadge} />
          </div>
          {nextBadgeText && (
            <p className="text-xs opacity-80 mt-1">🎖 {nextBadgeText}</p>
          )}

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "会員種別", value: planBadgeText },
              { label: "支援中", value: `${supports.length}頭` },
              { label: "月額合計", value: formatYen(monthlyGrandTotal) },
              { label: "予約", value: `${bookingCount ?? 0}件` },
            ].map((item) => (
              <div
                key={item.label}
                className="bg-white/15 rounded-xl px-3 py-2.5 backdrop-blur-sm"
              >
                <p className="text-xs opacity-75">{item.label}</p>
                <p className="text-base font-bold mt-0.5 truncate">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Status detail card ── */}
      <section className="card">
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="label">現在の会員種別</p>
            <p className="text-lg font-bold">{planBadgeText}</p>
            {isAttenderMember && (
              <p className="text-sm text-ink-soft">
                有効期限：{attenderExpiryText}
              </p>
            )}
            {hasSpecial && (
              <div className="pt-0.5">
                <span className="text-xs text-ink-soft">特別参加：</span>
                <span className="inline-flex flex-wrap gap-1 align-middle">
                  {summary?.rpt_active && <span className="chip-mute">リタポ</span>}
                  {specialTeamNames.map((n) => (
                    <span key={n} className="chip-mute">{n}</span>
                  ))}
                </span>
              </div>
            )}
            {MEMBER_PLAN_SELF_SERVICE_ENABLED && (
              <Link href="/mypage/plan" className="text-brand underline text-sm">
                {summary?.member_class_code ? "会員種別を変更" : "会員種別に入会する"}
              </Link>
            )}
          </div>
          <div className="space-y-1">
            <p className="label">お支払い状況</p>
            <span className={display.chipClass}>{display.label}</span>
            <p className="text-sm text-ink-soft mt-1">{display.description}</p>
          </div>
          <div className="space-y-1">
            <p className="label">月額支援合計</p>
            <p className="text-lg font-bold">{formatYen(monthlyGrandTotal)}</p>
          </div>
        </div>

        {display.bannerMessage && displayKey === "ok" && (
          <div className="mt-4 p-3 rounded-xl bg-green-50 border border-green-200">
            <p className="text-sm text-green-800">{display.bannerMessage}</p>
          </div>
        )}
        {displayKey === "failed" && (
          <div className="mt-4 p-4 rounded-xl bg-red-50 border-2 border-red-200 flex items-start gap-3">
            <span className="text-xl shrink-0">⚠️</span>
            <div>
              <p className="font-bold text-danger">お支払いが完了していません</p>
              <p className="text-sm mt-1 text-ink-soft">
                「お支払い情報を変更」からカード情報をご確認ください。
              </p>
            </div>
          </div>
        )}
        {scheduledStop.length > 0 && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-1">
            <p className="font-bold text-amber-800">停止予定の支援があります</p>
            {scheduledStop.map((s) => (
              <p key={s.id} className="text-sm text-amber-700">
                <Image src={horseImage} alt="" width={16} height={16} className="inline-block w-4 h-4 rounded-sm object-cover align-text-bottom mr-1" />{s.name}：{formatDate(s.date, false)} をもって終了予定
              </p>
            ))}
          </div>
        )}
      </section>

      {/* ── お知らせ・配信設定 ── */}
      <section>
        <h2 className="section-title">お知らせ</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Link href="/mypage/reports" className="card hover:shadow-lg transition-shadow group">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-brand-50 group-hover:bg-brand-100 flex items-center justify-center text-2xl transition-colors shrink-0">
                📅
              </div>
              <div>
                <p className="text-xs text-ink-mute mb-0.5">月ごとの使いみち</p>
                <p className="text-lg font-bold">収支報告</p>
                <p className="text-xs text-ink-soft mt-0.5">公開された月の収支を確認できます。</p>
              </div>
            </div>
          </Link>
          <Link href="/mypage/horse-reports" className="card hover:shadow-lg transition-shadow group">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-brand-50 group-hover:bg-brand-100 flex items-center justify-center text-2xl transition-colors shrink-0">
                ⭐
              </div>
              <div>
                <p className="text-xs text-ink-mute mb-0.5">馬の近況</p>
                <p className="text-lg font-bold">馬の月次報告</p>
                <p className="text-xs text-ink-soft mt-0.5">公開された馬の報告を読めます。</p>
              </div>
            </div>
          </Link>
          <Link href="/mypage/announcements" className="card hover:shadow-lg transition-shadow group">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-brand-50 group-hover:bg-brand-100 flex items-center justify-center text-2xl transition-colors shrink-0">
                📣
              </div>
              <div>
                <p className="text-xs text-ink-mute mb-0.5">事務局からのお知らせ</p>
                <p className="text-lg font-bold">お知らせを見る</p>
                <p className="text-xs text-ink-soft mt-0.5">あなた宛のお知らせを確認できます。</p>
              </div>
            </div>
          </Link>
          {canSeeCommunity(session.role) && <CommunityMypageCard />}
        </div>
      </section>

      {/* ── Supported horses ── */}
      <section className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title mb-0">支援中の馬</h2>
          {MEMBER_SELF_SERVICE_ENABLED && (
            <Link className="text-brand underline text-sm font-medium" href="/mypage/supports/new">
              + 新しい支援を追加
            </Link>
          )}
        </div>

        {supports.length === 0 ? (
          <div className="py-8 text-center">
            <div className="w-16 h-16 rounded-full overflow-hidden mx-auto mb-3">
              <Image src={horseImage} alt="horse" className="w-full h-full object-cover" />
            </div>
            <p className="text-ink-mute text-sm">現在、ご支援中の馬はありません。</p>
            {MEMBER_SELF_SERVICE_ENABLED ? (
              <Link href="/mypage/supports/new" className="btn-primary inline-flex mt-4">
                馬を支援する
              </Link>
            ) : (
              <p className="text-xs text-ink-soft mt-3">
                ご支援のお申し込みは運営にて承っております。お問い合わせください。
              </p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-surface-line">
            {supports.map((s) => {
              const isScheduledStop =
                s.status === "active" &&
                s.canceled_at &&
                new Date(s.canceled_at).getTime() > now;

              const statusColor =
                s.status === "active"
                  ? isScheduledStop
                    ? "bg-amber-100 text-amber-800"
                    : "bg-green-100 text-green-800"
                  : s.status === "past_due"
                  ? "bg-red-100 text-red-800"
                  : "bg-gray-100 text-gray-700";

              const statusLabel =
                s.status === "active"
                  ? isScheduledStop
                    ? "停止予定"
                    : "有効"
                  : s.status === "past_due"
                  ? "決済失敗"
                  : s.status === "canceled"
                  ? "停止済"
                  : s.status;

              return (
                <li key={s.id} className="py-4">
                  <div className="flex items-start gap-3">
                    {/* Horse image */}
                    {s.horse?.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.horse.image_url} alt={s.horse?.name ?? ""} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-brand-50 overflow-hidden shrink-0">
                        <Image src={horseImage} alt="horse" className="w-full h-full object-cover" />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold text-lg">{s.horse?.name ?? "—"}</p>
                        <span className={`chip text-xs ${statusColor}`}>{statusLabel}</span>
                      </div>
                      <p className="text-sm text-ink-soft mt-0.5">
                        {formatUnits(s.units)} / {formatYen(s.monthly_amount)} / 月
                      </p>
                      {isScheduledStop && (
                        <p className="text-xs text-amber-700 mt-1">
                          {formatDate(s.canceled_at, false)} をもって終了予定
                        </p>
                      )}
                    </div>

                    {MEMBER_SELF_SERVICE_ENABLED && (
                      <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                        <Link href={`/mypage/supports/${s.id}`} className="btn-secondary !py-2 !px-3 text-sm">
                          変更
                        </Link>
                        <Link href={`/mypage/supports/${s.id}/stop`} className="btn-ghost !py-2 !px-3 text-sm text-danger">
                          停止
                        </Link>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {MEMBER_SELF_SERVICE_ENABLED ? (
          supports.length > 0 && (
            <div className="mt-4 pt-4 border-t border-surface-line">
              <Link href="/mypage/supports/new" className="btn-primary w-full">
                新しい支援を追加する
              </Link>
            </div>
          )
        ) : (
          supports.length > 0 && (
            <div className="mt-4 pt-4 border-t border-surface-line">
              <p className="text-xs text-ink-soft">
                支援内容の追加・変更・停止は運営にて承っております。お手数ですが運営までお問い合わせください。
              </p>
            </div>
          )
        )}
      </section>

      {/* ── Special team memberships（既存加入者のみ表示） ── */}
      {specialTeams.length > 0 && (
      <section className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title mb-0">特別チーム会員</h2>
        </div>

        <ul className="divide-y divide-surface-line">
          {specialTeams.map((m) => {
            const isScheduledStop =
              m.status === "active" &&
              m.canceled_at &&
              new Date(m.canceled_at).getTime() > now;
            const statusColor =
              m.status === "active"
                ? isScheduledStop
                  ? "bg-amber-100 text-amber-800"
                  : "bg-green-100 text-green-800"
                : m.status === "past_due"
                ? "bg-red-100 text-red-800"
                : "bg-gray-100 text-gray-700";
            const statusLabel =
              m.status === "active"
                ? isScheduledStop
                  ? "停止予定"
                  : "有効"
                : m.status === "past_due"
                ? "決済失敗"
                : m.status === "incomplete"
                ? "手続き中"
                : m.status;
            return (
              <li key={m.id} className="py-4">
                <div className="flex items-start gap-3">
                  {m.horse?.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.horse.image_url} alt={m.horse?.name ?? ""} className="w-12 h-12 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-brand-50 overflow-hidden shrink-0">
                      <Image src={horseImage} alt="horse" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-lg">{m.horse?.name ?? "—"}</p>
                      <span className={`chip text-xs ${statusColor}`}>{statusLabel}</span>
                    </div>
                    <p className="text-sm text-ink-soft mt-0.5">
                      特別チーム会員 / {formatYen(m.monthly_amount)} / 月
                    </p>
                    {isScheduledStop && (
                      <p className="text-xs text-amber-700 mt-1">
                        {formatDate(m.canceled_at, false)} をもって終了予定
                      </p>
                    )}
                  </div>
                  {MEMBER_SELF_SERVICE_ENABLED && !isScheduledStop && m.status !== "canceled" && (
                    <SpecialTeamStopButton id={m.id} horseName={m.horse?.name ?? "対象馬"} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      )}

      {/* ── リタポ会員（RetouchPony Team） ── */}
      {MEMBER_SELF_SERVICE_ENABLED && (
      <section className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="section-title mb-0">リタポ会員（RetouchPony Team）</h2>
          {!summary?.rpt_active && (
            <Link className="text-brand underline text-sm font-medium" href="/mypage/rpt/new">
              + 申し込む
            </Link>
          )}
        </div>

        {summary?.rpt_active ? (
          <div className="flex items-center gap-3 py-2">
            <span className="chip bg-green-100 text-green-800 text-sm">加入中</span>
            <p className="text-sm text-ink-soft">RetouchPony【リタポ】メンバー / {formatYen(3000)} / 月</p>
          </div>
        ) : (
          <div className="py-4 text-center">
            <p className="text-ink-mute text-sm">
              リタポ会員は月額{formatYen(3000)}でRetouch馬の活動をご支援いただけます。<br />
              他の会員種別と併用可能です。
            </p>
            <Link href="/mypage/rpt/new" className="btn-secondary inline-flex mt-4">
              リタポ会員に申し込む
            </Link>
          </div>
        )}
      </section>
      )}

      {/* ── Quick actions ── */}
      {MEMBER_SELF_SERVICE_ENABLED && (
      <section>
        <h2 className="section-title">クイックアクション</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Link href="/mypage/donate" className="card hover:shadow-lg transition-shadow group">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-brand-50 group-hover:bg-brand-100 flex items-center justify-center text-2xl transition-colors shrink-0">
                💰
              </div>
              <div>
                <p className="text-xs text-ink-mute mb-0.5">単発寄付</p>
                <p className="text-lg font-bold">寄付する</p>
                <p className="text-xs text-ink-soft mt-0.5">単発での寄付・支援を行います。</p>
              </div>
            </div>
          </Link>
          <Link href="/mypage/bookings" className="card hover:shadow-lg transition-shadow group">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-brand-50 group-hover:bg-brand-100 flex items-center justify-center text-2xl transition-colors shrink-0">
                📅
              </div>
              <div>
                <p className="text-xs text-ink-mute mb-0.5">見学会・個別見学</p>
                <p className="text-lg font-bold">予約する</p>
                <p className="text-xs text-ink-soft mt-0.5">日程を選んで申し込みできます。</p>
              </div>
            </div>
          </Link>
          {supports.length > 0 && (
            <Link href="/mypage/horse-meeting" className="card hover:shadow-lg transition-shadow group">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-brand-50 group-hover:bg-brand-100 flex items-center justify-center text-2xl transition-colors shrink-0">
                  🐴
                </div>
                <div>
                  <p className="text-xs text-ink-mute mb-0.5">支援会員限定</p>
                  <p className="text-lg font-bold">馬の面会</p>
                  <p className="text-xs text-ink-soft mt-0.5">支援している馬との個別面会を申し込みます。</p>
                </div>
              </div>
            </Link>
          )}
        </div>
      </section>
      )}

      {/* ── Recent payments mini-list ── */}
      {recentPayments.length > 0 && (
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="section-title mb-0">直近の決済</h2>
            <Link href="/mypage/history" className="text-brand underline text-sm">
              全履歴を見る
            </Link>
          </div>
          <ul className="divide-y divide-surface-line">
            {recentPayments.slice(0, 3).map((p: any) => (
              <li key={p.id} className="py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{p.description ?? p.kind ?? "決済"}</p>
                  <p className="text-xs text-ink-mute">{formatDate(p.occurred_at, true)}</p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-bold tabular-nums">{formatYen(p.amount)}</span>
                  <span
                    className={`chip text-xs ${
                      p.status === "succeeded"
                        ? "chip-ok"
                        : p.status === "failed"
                        ? "chip-error"
                        : "chip-mute"
                    }`}
                  >
                    {p.status === "succeeded" ? "成功" : p.status === "failed" ? "失敗" : p.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Profile info ── */}
      <section className="card">
        <h2 className="section-title">登録情報</h2>
        <dl className="text-sm space-y-0 divide-y divide-surface-line">
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-soft">メール</dt>
            <dd className="font-medium">{customer?.email ?? "—"}</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-soft">電話番号</dt>
            <dd className="font-medium">{customer?.phone ?? "—"}</dd>
          </div>
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-soft">住所</dt>
            <dd className="text-right font-medium">
              {customer?.postal_code && <span>〒{customer.postal_code}<br /></span>}
              {customer?.address1}
              {customer?.address2 && <><br />{customer.address2}</>}
              {!customer?.address1 && "—"}
            </dd>
          </div>
        </dl>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-4">
          <Link href="/mypage/profile" className="btn-secondary text-center">
            情報を変更
          </Link>
          <form action="/api/stripe/portal" method="post" className="contents">
            <button type="submit" className="btn-secondary w-full">
              お支払い情報を変更
            </button>
          </form>
          <Link href="/mypage/history" className="btn-ghost text-center">
            履歴を見る
          </Link>
        </div>
      </section>
    </div>
  );
}
