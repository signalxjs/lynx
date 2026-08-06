/**
 * FLIK's game vocabulary. Pure data — this directory never imports `@sigx/*`
 * so the whole ruleset stays unit-testable in plain node.
 */

/** Player A owns the bottom of the board, B the top. */
export type Owner = 0 | 1;

export const PLAYER_A: Owner = 0;
export const PLAYER_B: Owner = 1;

/**
 * The five horizontal bands, bottom-relative to nobody: `homeA` is A's launch
 * zone AND B's overshoot trap, which is what makes stealing fall out of the
 * geometry rather than needing a rule of its own.
 */
export type Zone = 'homeA' | 'homeB' | 'targetA' | 'targetB' | 'field';

export interface Disc {
    id: number;
    /** Who may launch it. Flips when the disc settles in the other home. */
    owner: Owner;
    /** Board px. Two sizes; mass derives from it (see `massOf`). */
    r: number;
    /** Centre position in board px, y down. */
    x: number;
    y: number;
    /**
     * Reloads left. Spent whenever the disc settles in a home zone after a
     * shot; at zero it burns out and leaves the board. This is what stops a
     * match running forever — OLO's "death finger", minus the finger.
     */
    embers: number;
    /** False once burnt out. Burnt discs stay in the array for stable ids. */
    alive: boolean;
}

export type Phase = 'aiming' | 'simulating' | 'over';

export interface GameState {
    discs: Disc[];
    turn: Owner;
    phase: Phase;
    /**
     * Bumped on every launch and echoed back in the settle payload, so a
     * settle arriving from a superseded shot can be dropped rather than
     * applied to a board that has moved on.
     */
    seq: number;
    /**
     * The disc currently in flight, or `null` between shots.
     *
     * Load-bearing for the ember rule: a disc resting in its own home may
     * have bounced back there (a reload, which costs an ember) or may simply
     * have sat out the shot (which doesn't). Position alone can't tell those
     * apart — only knowing what was launched can.
     */
    launched: number | null;
}

/** Where a disc ended up, as reported by the simulation at quiescence. */
export interface SettledPosition {
    id: number;
    x: number;
    y: number;
}

/**
 * What `settleShot` decided, so the UI can narrate it (and later: play a
 * sound, buzz, animate the ember popping) without re-deriving any of it.
 */
export type ShotEvent =
    | { kind: 'scored'; discId: number; owner: Owner }
    | { kind: 'stolen'; discId: number; from: Owner; to: Owner }
    | { kind: 'reloaded'; discId: number; owner: Owner; embersLeft: number }
    | { kind: 'burnedOut'; discId: number; owner: Owner }
    | { kind: 'turnPassed'; player: Owner }
    | { kind: 'gameOver'; winner: Owner | null };
