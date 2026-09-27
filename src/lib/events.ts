// 見学会（visit）の会場判定と、申込フォームの選択肢定義。
//   会場はイベントの「場所(location)」（無ければタイトル）に
//   『千葉』『大阪』が含まれるかで自動判定する。
//   - 送迎(pickup)の集合場所は会場ごとに異なる
//   - 体験乗馬(riding)は千葉のみ
//   - 同伴者(companions)は両会場とも最大3名
// 申込API・申込フォーム・管理画面の表示が同じ定義を参照するため、
// 単一の出どころとしてここに集約する。

export type Venue = "chiba" | "osaka";

export type PickupOption = { code: string; label: string };
export type Relation = "family" | "friend" | "other";

export type Companion = {
  /** 同伴者の氏名（必須） */
  name: string;
  /** 関係性 */
  relation: Relation;
};

export const MAX_COMPANIONS = 3;

/** 送迎を希望しない場合のコード。 */
export const PICKUP_NONE = "none";

/** 会場ごとの送迎（集合場所）選択肢。先頭は「希望しない」。 */
export const PICKUP_OPTIONS: Record<Venue, PickupOption[]> = {
  chiba: [
    { code: PICKUP_NONE, label: "送迎を希望しない" },
    { code: "chiba_tokyo", label: "JR東京駅 11:35集合" },
    { code: "chiba_hyuga", label: "JR日向駅 12:55集合" },
  ],
  osaka: [
    { code: PICKUP_NONE, label: "送迎を希望しない" },
    { code: "osaka_mikkaichi", label: "南海高野線 三日市町 13:00集合" },
  ],
};

export const RELATION_OPTIONS: { value: Relation; label: string }[] = [
  { value: "family", label: "ご家族" },
  { value: "friend", label: "ご友人" },
  { value: "other", label: "その他" },
];

const VENUE_LABEL: Record<Venue, string> = { chiba: "千葉", osaka: "大阪" };

/**
 * イベントが千葉／大阪の見学会会場かを場所テキストから判定する。
 * いずれにも該当しなければ null（＝会場固有の追加項目は出さない）。
 */
export function eventVenue(
  e: { location?: string | null; title?: string | null } | null | undefined,
): Venue | null {
  if (!e) return null;
  const s = `${e.location ?? ""} ${e.title ?? ""}`;
  if (s.includes("千葉")) return "chiba";
  if (s.includes("大阪")) return "osaka";
  return null;
}

/** 体験乗馬（約5分）を申し込めるのは千葉のみ。 */
export function ridingAvailable(venue: Venue | null): boolean {
  return venue === "chiba";
}

export function venueLabel(venue: Venue): string {
  return VENUE_LABEL[venue];
}

/** 送迎コードから表示ラベルを引く（会場が分かる場合）。 */
export function pickupLabel(venue: Venue | null, code: string | null | undefined): string | null {
  if (!code || code === PICKUP_NONE) return null;
  if (venue) {
    const found = PICKUP_OPTIONS[venue].find((o) => o.code === code);
    if (found) return found.label;
  }
  // 会場不明でも全選択肢から探す（管理画面で会場推定できない場合の保険）。
  for (const v of Object.keys(PICKUP_OPTIONS) as Venue[]) {
    const found = PICKUP_OPTIONS[v].find((o) => o.code === code);
    if (found) return found.label;
  }
  return code;
}

export function relationLabel(relation: string | null | undefined): string {
  return RELATION_OPTIONS.find((r) => r.value === relation)?.label ?? "その他";
}

/** 全会場・全送迎コードの集合（API バリデーション用）。 */
export const ALL_PICKUP_CODES: string[] = Array.from(
  new Set(
    (Object.keys(PICKUP_OPTIONS) as Venue[]).flatMap((v) =>
      PICKUP_OPTIONS[v].map((o) => o.code),
    ),
  ),
);
