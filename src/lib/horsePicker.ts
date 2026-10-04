/** 馬名の先頭、または「62番目」から整理番号を取り出す。 */
export function horseSerialNumber(name: string): number | null {
  const leading = /^(\d+)/.exec(name.trim());
  if (leading) return Number(leading[1]);
  const ordinal = /(\d+)番目/.exec(name);
  if (ordinal) return Number(ordinal[1]);
  return null;
}

/** 名前に書かれた募集枠（【8口】【10口】）。 */
export function horseCapacityUnits(name: string): number | null {
  const match = /【(\d+(?:\.\d+)?)口】/.exec(name);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** 募集枠から現在の口数を引いた、まだ応募できる口数。枠が無い馬は null。 */
export function availableSupportUnits(capacity: number | null, currentUnits: number): number | null {
  if (capacity == null) return null;
  const remaining = capacity - currentUnits;
  return remaining > 0 ? remaining : 0;
}

/** 名前に番号が含まれるときは、先頭へ同じ番号を足さない。 */
export function horseOptionLabel(name: string, opening: string): string {
  const number = horseSerialNumber(name);
  const shownInName = number != null && new RegExp(`(^|[^0-9])0*${number}([^0-9]|$)`).test(name);
  const numberText = number != null && !shownInName ? String(number).padStart(2, "0") : "";
  return [numberText, name.trim(), opening.trim()].filter(Boolean).join("　");
}

export function compareHorsesByNumber(
  a: { name: string; sortOrder: number },
  b: { name: string; sortOrder: number },
): number {
  const aNumber = horseSerialNumber(a.name);
  const bNumber = horseSerialNumber(b.name);
  if (aNumber != null && bNumber != null && aNumber !== bNumber) return aNumber - bNumber;
  if (aNumber != null && bNumber == null) return -1;
  if (aNumber == null && bNumber != null) return 1;
  return a.sortOrder - b.sortOrder;
}
