import Link from "next/link";
import { requireMember } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  loadBookings,
  loadEvents,
  loadActiveSupports,
  loadCustomerSummary,
} from "@/lib/customer";
import { seatUsageBatch } from "@/lib/bookings";
import { eventVenue, pickupLabel, relationLabel } from "@/lib/events";
import { formatDate, statusLabel } from "@/lib/format";
import { MEMBER_SELF_SERVICE_ENABLED } from "@/lib/featureFlags";
import BookingButton from "./BookingButton";

export default async function BookingListPage() {
  const session = await requireMember();
  if (!session.customerId) return <div className="card">会員情報が見つかりません。</div>;

  const [events, myBookings, supports, summary] = await Promise.all([
    loadEvents(true),
    loadBookings(session.customerId, 20),
    loadActiveSupports(session.customerId),
    loadCustomerSummary(session.customerId),
  ]);
  const isSupporter = supports.length > 0;
  // 何らかの有料会員か（A/B/C・支援・RPT・特別チームのいずれか）。無料会員は false。
  const isPaidMember = Boolean(
    summary &&
      (summary.member_class_code || summary.rpt_active || (summary.special_team_count ?? 0) > 0),
  );

  const admin = createSupabaseAdminClient();
  const seatsUsed = await seatUsageBatch(admin as any, events.map((e) => e.id));
  const myEventIds = new Set(
    myBookings.filter((b) => b.status !== "canceled").map((b) => b.event_id),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">見学会・個別見学の予約</h1>
        <Link href="/mypage" className="text-brand underline">戻る</Link>
      </div>

      {!MEMBER_SELF_SERVICE_ENABLED && (
        <p className="card text-sm text-ink-soft">
          見学会・個別見学のご予約（新規・変更・取消）は、現在運営にて承っております。
          お手数ですが運営までお問い合わせください。
        </p>
      )}

      {!isPaidMember && (
        <p className="card text-sm text-ink-soft">
          見学会のご予約は会員様限定です。無料会員の方はお申し込みいただけません。
          いずれかの会員プラン・馬の支援にお申し込みのうえ、ご予約ください。
        </p>
      )}
      {isPaidMember && !isSupporter && (
        <p className="card text-sm text-ink-soft">
          支援者限定イベントは、馬の支援申し込み後にお申し込みいただけます。
        </p>
      )}

      <section className="card">
        <h2 className="section-title">開催予定</h2>
        {events.length === 0 && <p className="text-ink-mute">現在、公開中の予定はありません。</p>}
        <ul className="divide-y divide-surface-line">
          {events.map((ev) => {
            const used = seatsUsed.get(ev.id) ?? 0;
            const remaining = Math.max(0, ev.capacity - used);
            const alreadyBooked = myEventIds.has(ev.id);
            const isVisit = ev.type === "visit";
            const venue = eventVenue(ev);
            const blockedByMembership = isVisit && !isPaidMember;
            const blockedBySupport = ev.supporters_only && !isSupporter;
            const fullForOne = remaining < 1;
            const canBookOne =
              !alreadyBooked && !blockedByMembership && !blockedBySupport && !fullForOne;
            const maxSelectable = Math.min(20, Math.max(1, remaining));
            return (
              <li key={ev.id} className="py-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1">
                  <p className="font-bold">
                    {ev.title}
                    {ev.supporters_only && <span className="chip-warn ml-2">支援者限定</span>}
                    <span className="chip-mute ml-2">
                      {ev.type === "private_visit" ? "個別見学" : "見学会"}
                    </span>
                  </p>
                  <p className="text-sm text-ink-soft">
                    {formatDate(ev.starts_at, true)}
                    {ev.ends_at ? `〜${formatDate(ev.ends_at, true).split(" ")[1]}` : ""}
                  </p>
                  <p className="text-xs text-ink-mute">
                    定員 {ev.capacity} / 残り{" "}
                    <span className={remaining <= 0 ? "text-danger font-bold" : ""}>
                      {remaining}
                    </span>{" "}
                    席
                    {ev.location && ` / ${ev.location}`}
                  </p>
                </div>
                {alreadyBooked ? (
                  <span className="chip-ok">予約中</span>
                ) : !MEMBER_SELF_SERVICE_ENABLED ? (
                  <span className="chip-mute">運営受付</span>
                ) : blockedByMembership ? (
                  <span className="chip-mute">会員限定</span>
                ) : blockedBySupport ? (
                  <span className="chip-mute">対象外</span>
                ) : fullForOne ? (
                  <span className="chip-mute">満席</span>
                ) : (
                  <BookingButton
                    eventId={ev.id}
                    disabled={!canBookOne}
                    visit={isVisit}
                    venue={venue}
                    maxPartySize={maxSelectable}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="card">
        <h2 className="section-title">自分の予約</h2>
        {myBookings.length === 0 ? (
          <p className="text-ink-mute">予約はまだありません。</p>
        ) : (
          <ul className="divide-y divide-surface-line">
            {myBookings.map((b) => {
              const used = seatsUsed.get(b.event_id) ?? 0;
              const ev = b.event;
              const cap = ev?.capacity ?? 0;
              const isVisit = ev?.type === "visit";
              const venue = eventVenue(ev);
              // For an existing reservation we can grow up to (capacity - used + my own seats)
              const headroom = Math.max(1, Math.min(20, cap - used + Number(b.party_size ?? 0)));
              const pickup = pickupLabel(venue, b.pickup);
              const companions = b.companions ?? [];
              return (
                <li
                  key={b.id}
                  className="py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2"
                >
                  <div>
                    <p className="font-bold">{ev?.title}</p>
                    <p className="text-xs text-ink-soft">
                      {formatDate(ev?.starts_at, true)} ・ {b.party_size}名
                    </p>
                    {isVisit && (
                      <div className="text-xs text-ink-mute mt-1 space-y-0.5">
                        <p>送迎：{pickup ?? "希望しない"}</p>
                        {venue === "chiba" && (
                          <p>体験乗馬：{b.riding ? "希望する" : "希望しない"}</p>
                        )}
                        {companions.length > 0 && (
                          <p>
                            同伴者：
                            {companions
                              .map((c) => `${c.name}（${relationLabel(c.relation)}）`)
                              .join("、")}
                          </p>
                        )}
                      </div>
                    )}
                    {b.note && <p className="text-xs text-ink-mute mt-1">メモ：{b.note}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={b.status === "reserved" ? "chip-ok" : "chip-mute"}>
                      {statusLabel(b.status)}
                    </span>
                    {b.status === "reserved" && MEMBER_SELF_SERVICE_ENABLED && (
                      <>
                        <BookingButton
                          eventId={b.event_id}
                          edit
                          visit={isVisit}
                          venue={venue}
                          initialPartySize={b.party_size}
                          initialNote={b.note}
                          initialPickup={b.pickup}
                          initialRiding={b.riding}
                          initialCompanions={companions}
                          maxPartySize={headroom}
                        />
                        <BookingButton eventId={b.event_id} cancel />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
