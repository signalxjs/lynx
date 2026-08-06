/**
 * The ruleset. Pure functions over `GameState` — no clock, no randomness, no
 * `@sigx` imports, so every rule below is exercised directly in vitest.
 *
 * The simulation owns the board while a shot is in flight and reports final
 * positions once; everything here runs on that report. That split is what
 * keeps the background thread silent for the ~90 frames a shot lasts.
 */

import type {
    Disc,
    GameState,
    Owner,
    SettledPosition,
    ShotEvent,
} from './types.js';
import { PLAYER_A, PLAYER_B } from './types.js';
import {
    homeZoneOf,
    ownerOfHome,
    ownerOfTarget,
    targetZoneOf,
    zoneOf,
} from './board.js';

/** The other player. */
export function opponentOf(owner: Owner): Owner {
    return owner === PLAYER_A ? PLAYER_B : PLAYER_A;
}

/** Discs a player could launch right now: alive, theirs, sitting in their home. */
export function loadableDiscs(
    state: GameState,
    owner: Owner,
    boardHeight: number,
): Disc[] {
    const home = homeZoneOf(owner);
    return state.discs.filter(
        (d) => d.alive && d.owner === owner && zoneOf(d.y, boardHeight) === home,
    );
}

/** A player's score: their alive discs at rest in their own target zone. */
export function scoreOf(
    state: GameState,
    owner: Owner,
    boardHeight: number,
): number {
    const target = targetZoneOf(owner);
    return state.discs.filter(
        (d) => d.alive && d.owner === owner && zoneOf(d.y, boardHeight) === target,
    ).length;
}

/**
 * Nobody can shoot — no alive disc sits in any home zone. That is the honest
 * end condition: counting "shots taken" would strand a match where every
 * remaining disc is parked mid-field.
 */
export function isGameOver(state: GameState, boardHeight: number): boolean {
    return (
        loadableDiscs(state, PLAYER_A, boardHeight).length === 0
        && loadableDiscs(state, PLAYER_B, boardHeight).length === 0
    );
}

/** Higher score wins; equal scores are a draw (`null`). */
export function winnerOf(state: GameState, boardHeight: number): Owner | null {
    const a = scoreOf(state, PLAYER_A, boardHeight);
    const b = scoreOf(state, PLAYER_B, boardHeight);
    if (a === b) return null;
    return a > b ? PLAYER_A : PLAYER_B;
}

/**
 * Mark `discId` as launched — bumps `seq` so a stale settle can be rejected,
 * and records the disc so `settleShot` can tell a reload from a disc that
 * simply sat out the shot.
 */
export function beginShot(state: GameState, discId: number): GameState {
    return { ...state, phase: 'simulating', seq: state.seq + 1, launched: discId };
}

/**
 * Apply a settled board: adopt the final positions, then resolve every disc
 * that came to rest in a home zone.
 *
 * The home-zone rule is deliberately ONE rule covering both cases OLO names
 * separately. A disc resting in a home belongs to that home's owner (so
 * landing in the opponent's home is a steal — no extra rule) and spends an
 * ember for the privilege of being launchable again (so bouncing back into
 * your own home is a reload — also no extra rule). At zero embers it burns
 * out.
 *
 * "Resting in a home" is not quite enough on its own, though. A disc is
 * charged when it either **was the one launched** or **changed which home it
 * is in** — otherwise the opening line-up would burn down without a shot
 * fired, since every disc starts at home. Both halves are needed: the first
 * catches the launched disc bouncing back to where it started (a real
 * reload), the second catches a bystander knocked into a home.
 */
export function settleShot(
    state: GameState,
    positions: readonly SettledPosition[],
    boardHeight: number,
): { state: GameState; events: ShotEvent[] } {
    const events: ShotEvent[] = [];
    const byId = new Map(positions.map((p) => [p.id, p]));

    const discs = state.discs.map((disc) => {
        if (!disc.alive) return disc;
        const pos = byId.get(disc.id);
        if (!pos) return disc;

        const before = zoneOf(disc.y, boardHeight);
        const after = zoneOf(pos.y, boardHeight);
        const moved: Disc = { ...disc, x: pos.x, y: pos.y };

        if (ownerOfTarget(after) === moved.owner && before !== after) {
            events.push({ kind: 'scored', discId: moved.id, owner: moved.owner });
        }

        const arrivedIn = ownerOfHome(after);
        const startedIn = ownerOfHome(before);
        const wasLaunched = disc.id === state.launched;
        if (arrivedIn === null || (!wasLaunched && startedIn === arrivedIn)) {
            return moved;
        }

        if (arrivedIn !== moved.owner) {
            events.push({
                kind: 'stolen',
                discId: moved.id,
                from: moved.owner,
                to: arrivedIn,
            });
            moved.owner = arrivedIn;
        }

        moved.embers -= 1;
        if (moved.embers <= 0) {
            moved.embers = 0;
            moved.alive = false;
            events.push({ kind: 'burnedOut', discId: moved.id, owner: moved.owner });
        } else {
            events.push({
                kind: 'reloaded',
                discId: moved.id,
                owner: moved.owner,
                embersLeft: moved.embers,
            });
        }
        return moved;
    });

    let next: GameState = { ...state, discs, phase: 'aiming', launched: null };

    if (isGameOver(next, boardHeight)) {
        next = { ...next, phase: 'over' };
        events.push({ kind: 'gameOver', winner: winnerOf(next, boardHeight) });
        return { state: next, events };
    }

    // Hand over, skipping a player who has nothing to launch.
    const other = opponentOf(state.turn);
    if (loadableDiscs(next, other, boardHeight).length > 0) {
        next = { ...next, turn: other };
    } else {
        events.push({ kind: 'turnPassed', player: other });
    }

    return { state: next, events };
}
