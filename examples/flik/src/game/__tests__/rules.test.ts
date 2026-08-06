import { describe, it, expect } from 'vitest';

import {
    beginShot,
    isGameOver,
    loadableDiscs,
    opponentOf,
    scoreOf,
    settleShot,
    winnerOf,
} from '../rules';
import { newGame, START_EMBERS } from '../setup';
import { BANDS } from '../board';
import type { Disc, GameState, Owner, Zone } from '../types';
import { PLAYER_A, PLAYER_B } from '../types';

const W = 400;
const H = 1000;

/** A y-coordinate at the middle of `zone`. */
function midOf(zone: Zone): number {
    const band = BANDS.find((b) => b.zone === zone)!;
    return ((band.from + band.to) / 2) * H;
}

/** Build a board from a compact description, so each test states only what it means. */
function boardOf(
    spec: Array<{ owner: Owner; zone: Zone; embers?: number; alive?: boolean }>,
    turn: Owner = PLAYER_A,
): GameState {
    const discs: Disc[] = spec.map((s, i) => ({
        id: i,
        owner: s.owner,
        r: 14,
        x: 100 + i * 30,
        y: midOf(s.zone),
        embers: s.embers ?? START_EMBERS,
        alive: s.alive ?? true,
    }));
    return { discs, turn, phase: 'aiming', seq: 0, launched: null };
}

/**
 * Launch disc `id`, land it in the middle of `zone`, and settle — the full
 * shot cycle, which is the only way the ember rule sees a real reload.
 */
function shoot(state: GameState, id: number, zone: Zone) {
    return settleShot(beginShot(state, id), [{ id, x: 200, y: midOf(zone) }], H);
}

/** Settle without launching anything — for bystanders knocked about. */
function settleTo(state: GameState, id: number, zone: Zone) {
    return settleShot(state, [{ id, x: 200, y: midOf(zone) }], H);
}

describe('newGame', () => {
    it('gives both players six discs, all in their own home', () => {
        const g = newGame(W, H);
        expect(g.discs).toHaveLength(12);
        expect(loadableDiscs(g, PLAYER_A, H)).toHaveLength(6);
        expect(loadableDiscs(g, PLAYER_B, H)).toHaveLength(6);
        expect(g.turn).toBe(PLAYER_A);
        expect(g.phase).toBe('aiming');
    });

    it('mixes two big and four small per player', () => {
        const radii = newGame(W, H)
            .discs.filter((d) => d.owner === PLAYER_A)
            .map((d) => d.r)
            .sort((a, b) => a - b);
        expect(radii).toEqual([14, 14, 14, 14, 22, 22]);
    });

    it('starts nobody scoring and nobody having burned an ember', () => {
        const g = newGame(W, H);
        expect(scoreOf(g, PLAYER_A, H)).toBe(0);
        expect(scoreOf(g, PLAYER_B, H)).toBe(0);
        expect(g.discs.every((d) => d.embers === START_EMBERS)).toBe(true);
        expect(isGameOver(g, H)).toBe(false);
    });
});

describe('beginShot', () => {
    it('bumps seq so a settle from a superseded shot can be rejected', () => {
        const g = newGame(W, H);
        const shot = beginShot(g, 0);
        expect(shot.seq).toBe(g.seq + 1);
        expect(shot.phase).toBe('simulating');
        expect(shot.launched).toBe(0);
    });

    it('clears the launched disc once the shot settles', () => {
        const g = boardOf([{ owner: PLAYER_A, zone: 'homeA' }]);
        expect(shoot(g, 0, 'field').state.launched).toBeNull();
    });
});

describe('settleShot — scoring', () => {
    it("counts a disc that reaches its owner's target", () => {
        const g = boardOf([{ owner: PLAYER_A, zone: 'homeA' }]);
        const { state, events } = shoot(g, 0, 'targetA');

        expect(scoreOf(state, PLAYER_A, H)).toBe(1);
        expect(events).toContainEqual({ kind: 'scored', discId: 0, owner: PLAYER_A });
    });

    it("does not count a disc sitting in the OPPONENT's target", () => {
        const g = boardOf([{ owner: PLAYER_A, zone: 'homeA' }]);
        const { state } = shoot(g, 0, 'targetB');

        expect(scoreOf(state, PLAYER_A, H)).toBe(0);
        expect(scoreOf(state, PLAYER_B, H)).toBe(0);
    });

    it('stops counting a disc knocked back out of the target', () => {
        const scored = boardOf([{ owner: PLAYER_A, zone: 'targetA' }]);
        expect(scoreOf(scored, PLAYER_A, H)).toBe(1);

        const { state } = settleTo(scored, 0, 'field');
        expect(scoreOf(state, PLAYER_A, H)).toBe(0);
    });

    it('never counts a burnt-out disc', () => {
        const g = boardOf([{ owner: PLAYER_A, zone: 'targetA', alive: false }]);
        expect(scoreOf(g, PLAYER_A, H)).toBe(0);
    });
});

describe('settleShot — the home-zone rule', () => {
    it('steals a disc that overshoots into the opponent home, and charges an ember', () => {
        const g = boardOf([{ owner: PLAYER_A, zone: 'homeA' }]);
        const { state, events } = shoot(g, 0, 'homeB');

        expect(state.discs[0]!.owner).toBe(PLAYER_B);
        expect(state.discs[0]!.embers).toBe(START_EMBERS - 1);
        expect(events).toContainEqual({
            kind: 'stolen', discId: 0, from: PLAYER_A, to: PLAYER_B,
        });
        // And it is now B's to launch.
        expect(loadableDiscs(state, PLAYER_B, H).map((d) => d.id)).toEqual([0]);
    });

    it('reloads a knocked disc that ends up back in its own home', () => {
        const g = boardOf([{ owner: PLAYER_A, zone: 'field' }]);
        const { state, events } = settleTo(g, 0, 'homeA');

        expect(state.discs[0]!.owner).toBe(PLAYER_A);
        expect(state.discs[0]!.embers).toBe(START_EMBERS - 1);
        expect(events).toContainEqual({
            kind: 'reloaded', discId: 0, owner: PLAYER_A, embersLeft: START_EMBERS - 1,
        });
    });

    it('reloads the LAUNCHED disc when it falls short and returns home', () => {
        // Position alone can't see this — start and end are both homeA. Only
        // knowing the disc was the one launched distinguishes it from a disc
        // that sat out the shot.
        const g = boardOf([{ owner: PLAYER_A, zone: 'homeA' }]);
        const { state, events } = shoot(g, 0, 'homeA');

        expect(state.discs[0]!.embers).toBe(START_EMBERS - 1);
        expect(events).toContainEqual({
            kind: 'reloaded', discId: 0, owner: PLAYER_A, embersLeft: START_EMBERS - 1,
        });
    });

    it('burns the disc out when its last ember is spent', () => {
        const g = boardOf([{ owner: PLAYER_A, zone: 'field', embers: 1 }]);
        const { state, events } = settleTo(g, 0, 'homeA');

        expect(state.discs[0]!.alive).toBe(false);
        expect(state.discs[0]!.embers).toBe(0);
        expect(events).toContainEqual({ kind: 'burnedOut', discId: 0, owner: PLAYER_A });
        expect(loadableDiscs(state, PLAYER_A, H)).toHaveLength(0);
    });

    it('does NOT charge a bystander that sat out the shot in its own home', () => {
        // Otherwise the opening line-up would burn down without a shot fired.
        const g = boardOf([
            { owner: PLAYER_A, zone: 'homeA' },
            { owner: PLAYER_A, zone: 'homeA' },
        ]);
        const { state, events } = settleShot(
            beginShot(g, 0),
            [{ id: 0, x: 200, y: midOf('field') }, { id: 1, x: 260, y: midOf('homeA') }],
            H,
        );

        expect(state.discs[1]!.embers).toBe(START_EMBERS);
        expect(events.some((e) => e.kind === 'reloaded')).toBe(false);
    });

    it('does not charge a bystander shoved around WITHIN its own home', () => {
        const g = boardOf([
            { owner: PLAYER_B, zone: 'homeB' },
            { owner: PLAYER_A, zone: 'homeA' },
        ]);
        const { state } = settleShot(beginShot(g, 1), [
            { id: 0, x: 350, y: midOf('homeB') },
        ], H);

        expect(state.discs[0]!.embers).toBe(START_EMBERS);
    });

    it('leaves a disc the simulation did not report untouched', () => {
        const g = boardOf([
            { owner: PLAYER_A, zone: 'homeA' },
            { owner: PLAYER_B, zone: 'homeB' },
        ]);
        const before = g.discs[1]!;
        const { state } = settleTo(g, 0, 'field');

        expect(state.discs[1]).toEqual(before);
    });

    it('does not mutate the state it was given', () => {
        const g = boardOf([{ owner: PLAYER_A, zone: 'homeA' }]);
        const snapshot = JSON.parse(JSON.stringify(g)) as GameState;
        shoot(g, 0, 'homeB');
        expect(g).toEqual(snapshot);
    });
});

describe('settleShot — turn order', () => {
    it('hands over to the opponent', () => {
        const g = boardOf([
            { owner: PLAYER_A, zone: 'homeA' },
            { owner: PLAYER_B, zone: 'homeB' },
        ], PLAYER_A);
        const { state } = shoot(g, 0, 'field');
        expect(state.turn).toBe(PLAYER_B);
        expect(state.phase).toBe('aiming');
    });

    it('keeps the turn when the opponent has nothing to launch', () => {
        const g = boardOf([
            { owner: PLAYER_A, zone: 'homeA' },
            { owner: PLAYER_B, zone: 'field' },
        ], PLAYER_A);
        const { state, events } = shoot(g, 0, 'homeA');

        expect(state.turn).toBe(PLAYER_A);
        expect(events).toContainEqual({ kind: 'turnPassed', player: PLAYER_B });
    });

    it('gives the turn to a player who was just handed a stolen disc', () => {
        const g = boardOf([
            { owner: PLAYER_A, zone: 'homeA' },
            { owner: PLAYER_B, zone: 'field' },
        ], PLAYER_A);
        const { state } = shoot(g, 0, 'homeB');

        expect(state.discs[0]!.owner).toBe(PLAYER_B);
        expect(state.turn).toBe(PLAYER_B);
    });
});

describe('game over', () => {
    it('ends when no disc sits in any home zone', () => {
        const g = boardOf([
            { owner: PLAYER_A, zone: 'targetA' },
            { owner: PLAYER_B, zone: 'field' },
        ], PLAYER_A);
        expect(isGameOver(g, H)).toBe(true);
    });

    it('is not over while a disc is parked mid-field but another can still shoot', () => {
        const g = boardOf([
            { owner: PLAYER_A, zone: 'field' },
            { owner: PLAYER_B, zone: 'homeB' },
        ]);
        expect(isGameOver(g, H)).toBe(false);
    });

    it('reports the winner and the phase on the settling shot', () => {
        const g = boardOf([
            { owner: PLAYER_A, zone: 'targetA' },
            { owner: PLAYER_A, zone: 'homeA', embers: 1 },
        ], PLAYER_A);
        // The last loadable disc falls short, burns its final ember, and
        // leaves the board — after which nobody can shoot.
        const { state, events } = shoot(g, 1, 'homeA');

        expect(state.discs[1]!.alive).toBe(false);
        expect(state.phase).toBe('over');
        expect(events).toContainEqual({ kind: 'gameOver', winner: PLAYER_A });
    });

    it('calls an equal score a draw', () => {
        const g = boardOf([
            { owner: PLAYER_A, zone: 'targetA' },
            { owner: PLAYER_B, zone: 'targetB' },
        ]);
        expect(winnerOf(g, H)).toBeNull();
    });
});

describe('opponentOf', () => {
    it('is an involution', () => {
        expect(opponentOf(PLAYER_A)).toBe(PLAYER_B);
        expect(opponentOf(opponentOf(PLAYER_A))).toBe(PLAYER_A);
    });
});
