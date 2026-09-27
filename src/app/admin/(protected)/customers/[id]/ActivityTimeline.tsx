import { formatYen } from "@/lib/format";

export type ActivityItem = {
  at: string;
  kind:
    | "support_started"
    | "support_canceled"
    | "donation"
    | "booking"
    | "booking_canceled"
    | "payment"
    | "contract_started"
    | "contract_canceled";
  title: string;
  detail?: string | null;
  amount?: number | null;
  status?: string | null;
};

function formatDateTime(v: string) {
  const d = new Date(v);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const iconMap: Record<ActivityItem["kind"], { label: string; color: string }> = {
  support_started: { label: "支援開始", color: "bg-green-100 text-green-800" },
  support_canceled: { label: "支援停止", color: "bg-gray-200 text-gray-700" },
  donation: { label: "寄付", color: "bg-amber-100 text-amber-800" },
  booking: { label: "予約", color: "bg-blue-100 text-blue-800" },
  booking_canceled: { label: "予約取消", color: "bg-gray-200 text-gray-700" },
  payment: { label: "決済", color: "bg-indigo-100 text-indigo-800" },
  contract_started: { label: "契約開始", color: "bg-green-100 text-green-800" },
  contract_canceled: { label: "契約停止", color: "bg-gray-200 text-gray-700" },
};

export function buildActivity(params: {
  supports: any[];
  donations: any[];
  bookings: any[];
  payments: any[];
  contracts: any[];
}): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const s of params.supports ?? []) {
    items.push({
      at: s.started_at,
      kind: "support_started",
      title: `${s.horse?.name ?? "馬"} 支援開始`,
      detail: `${s.units}口 / ${formatYen(s.monthly_amount)}/月`,
      amount: s.monthly_amount,
      status: s.status,
    });
    if (s.canceled_at) {
      items.push({
        at: s.canceled_at,
        kind: "support_canceled",
        title: `${s.horse?.name ?? "馬"} 支援停止`,
        detail: `${s.units}口`,
      });
    }
  }

  for (const c of params.contracts ?? []) {
    items.push({
      at: c.started_at,
      kind: "contract_started",
      title: `契約開始（${c.plan?.name ?? "—"}）`,
      status: c.status,
    });
    if (c.canceled_at) {
      items.push({
        at: c.canceled_at,
        kind: "contract_canceled",
        title: `契約停止（${c.plan?.name ?? "—"}）`,
      });
    }
  }

  for (const d of params.donations ?? []) {
    items.push({
      at: d.donated_at,
      kind: "donation",
      title: "単発寄付",
      detail: d.message ?? null,
      amount: d.amount,
      status: d.status,
    });
  }

  for (const b of params.bookings ?? []) {
    items.push({
      at: b.booked_at,
      kind: "booking",
      title: `${b.event?.type === "private_visit" ? "個別見学" : "見学会"} 予約: ${b.event?.title ?? ""}`,
      detail: `${b.party_size}名`,
      status: b.status,
    });
    if (b.canceled_at) {
      items.push({
        at: b.canceled_at,
        kind: "booking_canceled",
        title: `${b.event?.type === "private_visit" ? "個別見学" : "見学会"} 予約取消: ${b.event?.title ?? ""}`,
      });
    }
  }

  for (const p of params.payments ?? []) {
    items.push({
      at: p.occurred_at,
      kind: "payment",
      title: `決済（${p.kind}）`,
      detail: p.failure_reason ?? null,
      amount: p.amount,
      status: p.status,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return items;
}

export default function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <p className="text-ink-mute text-sm">履歴はまだありません。</p>;
  }
  return (
    <ol className="relative border-l-2 border-surface-line pl-5 space-y-4">
      {items.map((it, idx) => {
        const meta = iconMap[it.kind];
        return (
          <li key={idx} className="relative">
            <span className="absolute -left-[28px] top-1 w-4 h-4 rounded-full bg-white border-2 border-brand" />
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={`chip ${meta.color}`}>{meta.label}</span>
              <span className="font-semibold text-sm">{it.title}</span>
              {it.amount != null && (
                <span className="text-sm text-ink">{formatYen(it.amount)}</span>
              )}
              {it.status && (
                <span className="text-xs text-ink-mute">[{it.status}]</span>
              )}
              <span className="ml-auto text-xs text-ink-mute">{formatDateTime(it.at)}</span>
            </div>
            {it.detail && <p className="text-xs text-ink-soft mt-1">{it.detail}</p>}
          </li>
        );
      })}
    </ol>
  );
}
