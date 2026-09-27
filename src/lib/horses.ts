import type { Horse } from "@/types/db";

export function isEmergencyRecruitmentHorse(
  horse: Pick<Horse, "is_emergency_recruitment" | "name">,
): boolean {
  return Boolean(horse.is_emergency_recruitment) || horse.name.includes("緊急支援募集馬");
}

export function compareHorsesForDisplay(
  a: Pick<Horse, "id" | "sort_order" | "is_emergency_recruitment" | "name">,
  b: Pick<Horse, "id" | "sort_order" | "is_emergency_recruitment" | "name">,
  supportUnits: (id: string) => number,
): number {
  const aEmergency = isEmergencyRecruitmentHorse(a);
  const bEmergency = isEmergencyRecruitmentHorse(b);
  if (aEmergency && !bEmergency) return -1;
  if (!aEmergency && bEmergency) return 1;
  if (aEmergency && bEmergency) return a.sort_order - b.sort_order;

  const ua = supportUnits(a.id);
  const ub = supportUnits(b.id);
  if (ua !== ub) return ub - ua;
  return a.sort_order - b.sort_order;
}
