/**
 * Flat-number codec for the two board handoffs between threads.
 *
 * Flat numbers rather than objects because both directions are JSON-serialized
 * across the bridge, and an array of `{id, x, y}` costs roughly three times
 * the bytes of the same data as bare numbers. It also lets the simulation
 * write into a PREALLOCATED buffer at quiescence instead of allocating one
 * inside a frame — the settle happens on the main thread, in the tick.
 *
 * Positions are quantised to 1/100 px. That is far below anything visible and
 * keeps each number short in the serialized form; the simulation's own state
 * stays full precision.
 */

import type { Disc, Owner, SettledPosition } from './types.js';

/** Numbers per disc in {@link packWorld}. */
export const WORLD_STRIDE = 7;
/** Numbers per disc in {@link packSettle}. */
export const SETTLE_STRIDE = 3;

function q(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * BG → MT: the full board for a turn setup.
 * Layout per disc: `[id, owner, r, x, y, alive, embers]`.
 */
export function packWorld(discs: readonly Disc[]): number[] {
    const out: number[] = new Array(discs.length * WORLD_STRIDE);
    let k = 0;
    for (const d of discs) {
        out[k++] = d.id;
        out[k++] = d.owner;
        out[k++] = d.r;
        out[k++] = q(d.x);
        out[k++] = q(d.y);
        out[k++] = d.alive ? 1 : 0;
        out[k++] = d.embers;
    }
    return out;
}

export function unpackWorld(packed: readonly number[]): Disc[] {
    const discs: Disc[] = [];
    for (let i = 0; i + WORLD_STRIDE <= packed.length; i += WORLD_STRIDE) {
        discs.push({
            id: packed[i]!,
            owner: packed[i + 1] as Owner,
            r: packed[i + 2]!,
            x: packed[i + 3]!,
            y: packed[i + 4]!,
            alive: packed[i + 5] === 1,
            embers: packed[i + 6]!,
        });
    }
    return discs;
}

/**
 * MT → BG: where everything ended up, once per shot.
 * Layout per disc: `[id, x, y]`. Ownership and embers are the ruleset's
 * business, so the simulation doesn't report them — it doesn't know them.
 */
export function packSettle(
    positions: readonly SettledPosition[],
    into?: number[],
): number[] {
    const out = into ?? new Array<number>(positions.length * SETTLE_STRIDE);
    let k = 0;
    for (const p of positions) {
        out[k++] = p.id;
        out[k++] = q(p.x);
        out[k++] = q(p.y);
    }
    out.length = k;
    return out;
}

export function unpackSettle(packed: readonly number[]): SettledPosition[] {
    const out: SettledPosition[] = [];
    for (let i = 0; i + SETTLE_STRIDE <= packed.length; i += SETTLE_STRIDE) {
        out.push({ id: packed[i]!, x: packed[i + 1]!, y: packed[i + 2]! });
    }
    return out;
}
