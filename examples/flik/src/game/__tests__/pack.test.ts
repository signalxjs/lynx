import { describe, it, expect } from 'vitest';

import {
    SETTLE_STRIDE,
    WORLD_STRIDE,
    packSettle,
    packWorld,
    unpackSettle,
    unpackWorld,
} from '../pack';
import { newGame, stressLayout } from '../setup';

describe('packWorld', () => {
    it('round-trips a board, positions quantised to 1/100 px', () => {
        const discs = newGame(400, 1000).discs;
        const back = unpackWorld(packWorld(discs));

        expect(back).toHaveLength(discs.length);
        back.forEach((d, i) => {
            const src = discs[i]!;
            expect({ ...d, x: 0, y: 0 }).toEqual({ ...src, x: 0, y: 0 });
            // The quantisation is deliberate — sub-1/100 px is invisible and
            // costs bytes on every wire crossing.
            expect(d.x).toBeCloseTo(src.x, 2);
            expect(d.y).toBeCloseTo(src.y, 2);
        });
    });

    it('emits one stride per disc and nothing else', () => {
        const discs = newGame(400, 1000).discs;
        expect(packWorld(discs)).toHaveLength(discs.length * WORLD_STRIDE);
    });

    it('is all numbers, so it survives the bridge as JSON', () => {
        const packed = packWorld(newGame(400, 1000).discs);
        expect(packed.every((n) => typeof n === 'number' && Number.isFinite(n))).toBe(true);
    });

    it('preserves the alive flag across the number encoding', () => {
        const discs = newGame(400, 1000).discs.map((d, i) => ({ ...d, alive: i % 2 === 0 }));
        expect(unpackWorld(packWorld(discs)).map((d) => d.alive)).toEqual(
            discs.map((d) => d.alive),
        );
    });

    it('ignores a trailing partial record rather than emitting a broken disc', () => {
        const packed = packWorld(newGame(400, 1000).discs);
        packed.push(999, 0, 14); // truncated tail
        expect(unpackWorld(packed)).toHaveLength(12);
    });
});

describe('packSettle', () => {
    it('round-trips positions', () => {
        const positions = [
            { id: 0, x: 12.5, y: 300.25 },
            { id: 5, x: 399.99, y: 0 },
        ];
        expect(unpackSettle(packSettle(positions))).toEqual(positions);
    });

    it('quantises to 1/100 px', () => {
        const packed = packSettle([{ id: 0, x: 12.34567, y: 8.19999 }]);
        expect(packed).toEqual([0, 12.35, 8.2]);
    });

    it('reuses a caller-supplied buffer and truncates it to the payload', () => {
        // The simulation packs inside the frame, so it must not allocate.
        const buffer = new Array<number>(600).fill(-1);
        const packed = packSettle([{ id: 1, x: 2, y: 3 }], buffer);

        expect(packed).toBe(buffer);
        expect(packed).toEqual([1, 2, 3]);
        expect(packed).toHaveLength(SETTLE_STRIDE);
    });

    it('handles a stress-sized board', () => {
        const discs = stressLayout(400, 400, 1000);
        const positions = discs.map((d) => ({ id: d.id, x: d.x, y: d.y }));
        expect(unpackSettle(packSettle(positions))).toHaveLength(400);
    });
});

describe('stressLayout', () => {
    it('is deterministic, so two measurements are comparable', () => {
        expect(stressLayout(50, 400, 1000)).toEqual(stressLayout(50, 400, 1000));
    });

    it('keeps every disc on the board', () => {
        for (const d of stressLayout(200, 400, 1000)) {
            expect(d.x).toBeGreaterThanOrEqual(0);
            expect(d.x).toBeLessThanOrEqual(400);
            expect(d.y).toBeGreaterThanOrEqual(0);
            expect(d.y).toBeLessThanOrEqual(1000);
        }
    });

    it('gives every disc a unique id', () => {
        const ids = stressLayout(400, 400, 1000).map((d) => d.id);
        expect(new Set(ids).size).toBe(400);
    });

    it('mixes both disc sizes', () => {
        const radii = new Set(stressLayout(200, 400, 1000).map((d) => d.r));
        expect(radii.size).toBe(2);
    });
});
