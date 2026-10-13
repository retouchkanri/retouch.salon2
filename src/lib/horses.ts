import type { Horse } from "@/types/db";

/**
 * 新規募集の枠として作られた行か（馬名が「59：緊急支援募集馬」のように、馬の名前ではなく募集の枠になっている行）。
 * 新規募集の特別な表示はやめたので、この行は公開ページと会員の支援申込みには出さない。
 * 行そのものは残す：すでに付いている支援や過去の記録が、この行を参照しているため。
 * 馬名を実際の馬の名前に直せば、ほかの馬と同じように表示される。
 */
export function isRecruitmentSlot(horse: Pick<Horse, "name">): boolean {
  return horse.name.includes("緊急支援募集馬");
}

/** 馬一覧の並び順。どの馬も同じ扱いで、支援口数の多い順、同じなら馬マスタの並び順。 */
export function compareHorsesForDisplay(
  a: Pick<Horse, "id" | "sort_order">,
  b: Pick<Horse, "id" | "sort_order">,
  supportUnits: (id: string) => number,
): number {
  const ua = supportUnits(a.id);
  const ub = supportUnits(b.id);
  if (ua !== ub) return ub - ua;
  return a.sort_order - b.sort_order;
}
