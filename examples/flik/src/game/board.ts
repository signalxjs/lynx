/**
 * Board geometry — the single source of truth for FLIK's rules.
 *
 * Every rule in `rules.ts` is a consequence of this one table, which is the
 * point: OLO's ruleset is ambiguous about whether one player's target overlaps
 * the other's home, and encoding the answer as scattered constants would make
 * "try it the other way" a rewrite. Here it is one edit.
 *
 * The bands are non-overlapping and ordered top to bottom (y grows downward,
 * matching screen coordinates):
 *
 * ```
 *   0.00  ┌──────────────┐
 *         │    homeB     │  B launches downward from here
 *   0.13  ├──────────────┤
 *         │   targetA    │  A scores here
 *   0.30  ├──────────────┤
 *         │              │
 *         │    field     │
 *         │              │
 *   0.70  ├──────────────┤
 *         │   targetB    │  B scores here
 *   0.87  ├──────────────┤
 *         │    homeA     │  A launches upward from here
 *   1.00  └──────────────┘
 * ```
 *
 * So overshooting your target drops you in the opponent's home — stolen — and
 * falling short bounces you back into your own — reloaded. Neither needs a
 * rule; they are both just `zoneOf`.
 */

import type { Owner, Zone } from './types.js';
import { PLAYER_A, PLAYER_B } from './types.js';

/** Band boundaries as fractions of board height, `[startY, endY)`. */
export const BANDS: ReadonlyArray<{ zone: Zone; from: number; to: number }> = [
    { zone: 'homeB', from: 0.0, to: 0.13 },
    { zone: 'targetA', from: 0.13, to: 0.3 },
    { zone: 'field', from: 0.3, to: 0.7 },
    { zone: 'targetB', from: 0.7, to: 0.87 },
    { zone: 'homeA', from: 0.87, to: 1.0 },
];

/**
 * Which band a disc CENTRE sits in.
 *
 * Centre-based rather than "fully inside": a disc straddling a boundary has to
 * belong somewhere, and requiring full containment would make the big discs
 * meaningfully harder to score than the small ones for reasons the player
 * can't see.
 */
export function zoneOf(y: number, boardHeight: number): Zone {
    if (boardHeight <= 0) return 'field';
    const t = y / boardHeight;
    for (const band of BANDS) {
        if (t < band.to) return band.zone;
    }
    return 'homeA';
}

/** The zone a player launches from. */
export function homeZoneOf(owner: Owner): Zone {
    return owner === PLAYER_A ? 'homeA' : 'homeB';
}

/** The zone a player scores in — at the far end from their home. */
export function targetZoneOf(owner: Owner): Zone {
    return owner === PLAYER_A ? 'targetA' : 'targetB';
}

/** Whose home a zone is, or `null` if it isn't one. */
export function ownerOfHome(zone: Zone): Owner | null {
    if (zone === 'homeA') return PLAYER_A;
    if (zone === 'homeB') return PLAYER_B;
    return null;
}

/** Whose target a zone is, or `null` if it isn't one. */
export function ownerOfTarget(zone: Zone): Owner | null {
    if (zone === 'targetA') return PLAYER_A;
    if (zone === 'targetB') return PLAYER_B;
    return null;
}

/** A band's pixel rect, for drawing it and for placing discs inside it. */
export function bandRect(
    zone: Zone,
    boardWidth: number,
    boardHeight: number,
): { x: number; y: number; width: number; height: number } {
    const band = BANDS.find((b) => b.zone === zone) ?? BANDS[2]!;
    return {
        x: 0,
        y: band.from * boardHeight,
        width: boardWidth,
        height: (band.to - band.from) * boardHeight,
    };
}

/** Which way a player shoots: A upward (negative y), B downward. */
export function launchDirection(owner: Owner): -1 | 1 {
    return owner === PLAYER_B ? 1 : -1;
}
