import { MEDAL_LABELS_JP, type Badge, type Medal } from "@/lib/roles";

/** Staff crown icon served from /public (avoids bundling multi-MB PNGs). */
const CROWN_ICON = "/badges/crown.png";

/** Open-licensed (Twemoji, CC-BY) icons bundled under /public/badges. */
const MEDAL_ICON: Record<Medal, string> = {
  gold: "/badges/medal-gold.svg",
  silver: "/badges/medal-silver.svg",
  bronze: "/badges/medal-bronze.svg",
};

/**
 * Renders a pre-resolved rank badge (see roles.resolveBadge).
 *  - Staff: N crown badges (owner ×3, admin ×2, moderator ×1).
 *  - Members: a Gold / Silver / Bronze medal with its label.
 *  - "none": nothing (e.g. a freshly-registered member).
 * Pure presentational component — safe in both server and client trees.
 */
export default function RoleBadge({
  badge,
  size = 20,
}: {
  badge: Badge;
  size?: number;
}) {
  if (badge.kind === "none") return null;

  if (badge.kind === "full") {
    return (
      <span
        className="inline-flex items-center gap-0.5 align-middle"
        title={`王冠 ×${badge.count}`}
        aria-label={`王冠バッジ ${badge.count}個`}
      >
        {Array.from({ length: badge.count }).map((_, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={CROWN_ICON}
            alt=""
            width={size}
            height={size}
            className="inline-block select-none object-contain"
            aria-hidden
          />
        ))}
      </span>
    );
  }

  const label = MEDAL_LABELS_JP[badge.tier];
  return (
    <span className="inline-flex items-center gap-1 align-middle" title={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={MEDAL_ICON[badge.tier]}
        alt={label}
        width={size}
        height={size}
        className="inline-block select-none"
      />
      <span className="text-xs font-semibold text-ink-soft">{label}</span>
    </span>
  );
}
