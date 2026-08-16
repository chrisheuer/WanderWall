/** Commerce tiers — the single source of truth for caps and pricing copy. */

export type Tier = "S" | "L" | "download";

export const TIER_CAPS: Record<Tier, number> = {
  S: 50,
  L: 120,
  download: 120,
};

export const MIN_PIECES = 3;
export const MAX_PIECES = 120;

/** Piece count at which galleries auto-segment into multiple rooms. */
export const ROOM_SEGMENT_THRESHOLD = 14;

export const PRICING = {
  creationOneTimeCents: 2999,
  S: { monthlyCents: 800, annualBundleCents: 9900 },
  L: { monthlyCents: 1000, annualBundleCents: 12900 },
  downloadOneTimeCents: 2999,
} as const;

/** Download tier: editing + re-export window after purchase. */
export const DOWNLOAD_EDIT_WINDOW_DAYS = 3;

export function tierForPieceCount(count: number): "S" | "L" {
  return count <= TIER_CAPS.S ? "S" : "L";
}

export function pieceCapFor(tier: Tier): number {
  return TIER_CAPS[tier];
}

/**
 * Crossing the 50-piece boundary is a subscription update with proration,
 * never a new creation fee.
 */
export function requiresTierUpgrade(tier: Tier, pieceCount: number): boolean {
  return tier === "S" && pieceCount > TIER_CAPS.S;
}

export function editWindowOpen(editWindowExpiresAt: Date | null): boolean {
  if (!editWindowExpiresAt) return true; // hosted tiers have no window
  return editWindowExpiresAt.getTime() > Date.now();
}
