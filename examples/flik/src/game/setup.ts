/**
 * Starting layouts — the real game, and the stress-mode board the perf work
 * (PR 7) scales up.
 */

import type { Disc, GameState, Owner } from './types.js';
import { PLAYER_A, PLAYER_B } from './types.js';
import { bandRect, homeZoneOf } from './board.js';

/** Radii in board px. Mass scales with area, so big discs shove small ones. */
export const R_BIG = 22;
export const R_SMALL = 14;

/** Reloads a disc starts with. Three, as in OLO. */
export const START_EMBERS = 3;

/** Per player: 2 big, 4 small. */
const DISC_RADII = [R_BIG, R_BIG, R_SMALL, R_SMALL, R_SMALL, R_SMALL];

/**
 * Mass from radius. Area-proportional and normalised so a big disc is 1.0 —
 * a small one lands at ~0.405, heavy enough to be knocked clear by a big one
 * but not so light it pinballs.
 */
export function massOf(r: number): number {
    return (r * r) / (R_BIG * R_BIG);
}

/** Lay a player's discs out in a row inside their home zone. */
function placeInHome(
    owner: Owner,
    startId: number,
    boardWidth: number,
    boardHeight: number,
): Disc[] {
    const rect = bandRect(homeZoneOf(owner), boardWidth, boardHeight);
    const cy = rect.y + rect.height / 2;
    const n = DISC_RADII.length;
    const step = boardWidth / (n + 1);

    return DISC_RADII.map((r, i) => ({
        id: startId + i,
        owner,
        r,
        x: step * (i + 1),
        y: cy,
        embers: START_EMBERS,
        alive: true,
    }));
}

export function newGame(boardWidth: number, boardHeight: number): GameState {
    return {
        discs: [
            ...placeInHome(PLAYER_A, 0, boardWidth, boardHeight),
            ...placeInHome(PLAYER_B, DISC_RADII.length, boardWidth, boardHeight),
        ],
        turn: PLAYER_A,
        phase: 'aiming',
        seq: 0,
        launched: null,
    };
}

/**
 * A jittered grid of `count` discs filling the field, for the stress harness.
 * Deterministic (no `Math.random`) so a run is reproducible and two
 * measurements are comparable — the whole point is to compare numbers.
 */
export function stressLayout(
    count: number,
    boardWidth: number,
    boardHeight: number,
): Disc[] {
    const cols = Math.max(1, Math.ceil(Math.sqrt(count * (boardWidth / boardHeight))));
    const rows = Math.max(1, Math.ceil(count / cols));
    const cellW = boardWidth / cols;
    const cellH = boardHeight / rows;
    const discs: Disc[] = [];

    for (let i = 0; i < count; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        // Cheap deterministic hash for the jitter and the size mix.
        const h = (i * 2654435761) >>> 0;
        const jx = ((h & 0xff) / 255 - 0.5) * cellW * 0.4;
        const jy = (((h >>> 8) & 0xff) / 255 - 0.5) * cellH * 0.4;
        const big = ((h >>> 16) & 3) === 0;
        discs.push({
            id: i,
            owner: (row < rows / 2 ? PLAYER_B : PLAYER_A) as Owner,
            r: big ? R_BIG : R_SMALL,
            x: cellW * (col + 0.5) + jx,
            y: cellH * (row + 0.5) + jy,
            embers: START_EMBERS,
            alive: true,
        });
    }
    return discs;
}
