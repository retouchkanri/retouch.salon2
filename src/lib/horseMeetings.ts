/** 馬の面会申込 — 定数・ラベル（イベントマスタに日付を365件登録しない方式） */

export const HORSE_MEETING_FACILITIES = [
  { value: "osaka_horserest", label: "大阪：ホースレスト" },
  { value: "chiba_forest", label: "千葉：引退馬の森" },
  { value: "chiba_hyuga", label: "千葉：日向の学校施設" },
] as const;

export type HorseMeetingFacility = (typeof HORSE_MEETING_FACILITIES)[number]["value"];

export const HORSE_MEETING_TIME_SLOTS = ["10時～", "11時～", "14時～", "15時～"] as const;
export type HorseMeetingTimeSlot = (typeof HORSE_MEETING_TIME_SLOTS)[number];

export const HORSE_MEETING_ARRIVAL_METHODS = [
  { value: "car", label: "自家用車" },
  { value: "pickup_mikuni", label: "南海高野線 三日市町までのお迎え希望" },
  { value: "pickup_hyuga", label: "JR日向駅までのお迎え希望" },
] as const;

export type HorseMeetingArrivalMethod = (typeof HORSE_MEETING_ARRIVAL_METHODS)[number]["value"];

export const HORSE_MEETING_STATUSES = ["pending", "approved", "canceled", "completed"] as const;
export type HorseMeetingStatus = (typeof HORSE_MEETING_STATUSES)[number];

const FACILITY_LABELS = Object.fromEntries(
  HORSE_MEETING_FACILITIES.map((f) => [f.value, f.label]),
) as Record<HorseMeetingFacility, string>;

const ARRIVAL_LABELS = Object.fromEntries(
  HORSE_MEETING_ARRIVAL_METHODS.map((a) => [a.value, a.label]),
) as Record<HorseMeetingArrivalMethod, string>;

export function horseMeetingFacilityLabel(value: string | null | undefined): string {
  if (!value) return "—";
  return FACILITY_LABELS[value as HorseMeetingFacility] ?? value;
}

export function horseMeetingArrivalLabel(
  method: string | null | undefined,
  pickupTime?: string | null,
): string {
  if (!method) return "—";
  const base = ARRIVAL_LABELS[method as HorseMeetingArrivalMethod] ?? method;
  if (pickupTime && method !== "car") return `${base}（${pickupTime}）`;
  return base;
}

export function horseMeetingStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "pending":
      return "受付中";
    case "approved":
      return "承認済";
    case "canceled":
      return "取消";
    case "completed":
      return "参加済";
    default:
      return status ?? "—";
  }
}

export function formatSupportedHorsesForInput(
  supports: { units: number; horse?: { name?: string | null } | null }[],
): string {
  return supports
    .map((s) => {
      const name = s.horse?.name ?? "—";
      const u = Number(s.units);
      const unitLabel = Number.isInteger(u) ? `${u}口` : `${u.toFixed(1)}口`;
      return `${name}（${unitLabel}）`;
    })
    .join("、");
}
