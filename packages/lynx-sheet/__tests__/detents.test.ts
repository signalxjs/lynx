/**
 * Detent resolution — declared specs → ascending px heights. This is the
 * math the showcase EmojiComposer used to hand-roll (keyboard height +
 * bottom-inset add-back, header caps, ascending guarantees), locked down
 * as the package's contract.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LogRecord } from '@sigx/lynx-core';
import {
    DEFAULT_KEYBOARD_FALLBACK_PX,
    resolveDetents,
    type DetentEnv,
} from '../src/detents';

const ENV: DetentEnv = { screenH: 800 };

describe('resolveDetents — px and fraction specs', () => {
    it('passes px specs through, sorted ascending and deduped', () => {
        expect(resolveDetents([720, 64, { px: 320 }, 320], ENV)).toEqual([64, 320, 720]);
    });

    it('resolves fractions against screen height, rounded', () => {
        expect(resolveDetents([{ fraction: 0.92 }], ENV)).toEqual([736]);
        expect(resolveDetents([{ fraction: 1 }], ENV)).toEqual([800]);
    });

    it('drops invalid specs instead of reinterpreting them', () => {
        // A fraction past the screen or a non-positive px is a config
        // error, not something to guess at.
        expect(resolveDetents([{ fraction: 1.5 }, { fraction: 0 }, -10, { px: 0 }, 400], ENV))
            .toEqual([400]);
    });

    it('drops non-object garbage from untyped JS callers instead of throwing', () => {
        const garbage = [null, undefined, 'nope', 400] as unknown as Parameters<
            typeof resolveDetents
        >[0];
        expect(resolveDetents(garbage, ENV)).toEqual([400]);
    });

    it('falls back to half the screen when nothing valid remains', () => {
        expect(resolveDetents([], ENV)).toEqual([400]);
        expect(resolveDetents(undefined, ENV)).toEqual([400]);
        expect(resolveDetents([{ fraction: 2 }], ENV)).toEqual([400]);
    });
});

describe('resolveDetents — topOffset cap', () => {
    it('clamps every detent to screenH - topOffset', () => {
        // The EmojiComposer case: insets.top + header must stay visible.
        expect(resolveDetents([320, { fraction: 0.92 }], { screenH: 800, topOffset: 100 }))
            .toEqual([320, 700]);
    });

    it('dedupes detents that collapse onto the cap', () => {
        expect(resolveDetents([680, { fraction: 0.92 }], { screenH: 800, topOffset: 120 }))
            .toEqual([680]);
    });

    it('subtracts bottomOffset — a safe-area-padded sheet caps lower', () => {
        // The "handle disappears behind the header" bug: the sheet's bottom
        // sits `bottomOffset` above the true screen bottom, so a cap
        // measured from the full screen height let the sheet's top slide
        // under the header by exactly that amount.
        expect(
            resolveDetents([{ fraction: 0.92 }], { screenH: 800, topOffset: 100, bottomOffset: 24 }),
        ).toEqual([676]);
    });
});

describe('resolveDetents — keyboard specs', () => {
    it('rides the floor on the remembered keyboard height plus bottom inset', () => {
        // Keyboard lift values are inset-discounted while the sheet
        // reaches the true screen bottom — the inset is added back here.
        expect(
            resolveDetents([64, { keyboard: true }], {
                screenH: 800,
                bottomInset: 24,
                keyboardPx: 300,
            }),
        ).toEqual([64, 64 + 300 + 24]);
    });

    it('does not add back an inset that bottomOffset already covers (#811)', () => {
        // A sheet whose ancestor pads the gesture bar ends `bottomOffset`
        // short of the screen, so it never has to cover that inset. Adding
        // it back anyway opened the composer's emoji panel a gesture bar
        // taller than the keyboard — and, since this detent is also
        // `setReveal`'s `openFloor`, clamped away the live openToLift
        // capture, jumping the input row on every swap.
        expect(
            resolveDetents([64, { keyboard: true }], {
                screenH: 800,
                bottomOffset: 24,
                bottomInset: 24,
                keyboardPx: 300,
            }),
        ).toEqual([64, 64 + 300]);
    });

    it('adds back only the uncovered remainder of the inset', () => {
        expect(
            resolveDetents([64, { keyboard: true }], {
                screenH: 800,
                bottomOffset: 10,
                bottomInset: 24,
                keyboardPx: 300,
            }),
        ).toEqual([64, 64 + 300 + 14]);
        // A bottomOffset past the inset never subtracts below zero.
        expect(
            resolveDetents([64, { keyboard: true }], {
                screenH: 800,
                bottomOffset: 40,
                bottomInset: 24,
                keyboardPx: 300,
            }),
        ).toEqual([64, 64 + 300]);
    });

    it('falls back while no keyboard has been observed yet', () => {
        expect(
            resolveDetents([64, { keyboard: true, fallbackPx: 336 }], {
                screenH: 800,
                bottomInset: 24,
            }),
        ).toEqual([64, 64 + 336]);
        expect(resolveDetents([64, { keyboard: true }], ENV))
            .toEqual([64, 64 + DEFAULT_KEYBOARD_FALLBACK_PX]);
    });

    it('a keyboard detent as the only spec rides a zero floor', () => {
        expect(
            resolveDetents([{ keyboard: true }], { screenH: 800, bottomInset: 24, keyboardPx: 300 }),
        ).toEqual([324]);
    });

    it('keyboard detents obey the topOffset cap', () => {
        expect(
            resolveDetents([64, { keyboard: true }], {
                screenH: 800,
                topOffset: 500,
                keyboardPx: 400,
                bottomInset: 0,
            }),
        ).toEqual([64, 300]);
    });
});

describe('resolveDetents — dropped-spec diagnostic (C10)', () => {
    it('warns through the logger, once, when every declared spec was dropped', async () => {
        // A fresh module graph: the warning is one-shot per context (see
        // `warnedAllSpecsDropped`), so it has to be observed from a module
        // instance no earlier test has already tripped.
        vi.resetModules();
        const core = await import('@sigx/lynx-core');
        const { resolveDetents: resolve } = await import('../src/detents');
        const records: LogRecord[] = [];
        core.clearTransports();
        core.addTransport((r) => { records.push(r); });

        // Declaring nothing is the documented default, not a config error.
        resolve(undefined, ENV);
        resolve([], ENV);
        expect(records).toHaveLength(0);

        // Every spec rejected, though, means the caller declared detents and
        // silently got the half-screen default instead.
        resolve([{ fraction: 1.5 }, { px: 0 }], ENV);
        expect(records).toHaveLength(1);
        expect(records[0]!.namespace).toBe('lynx-sheet');
        expect(records[0]!.level.name).toBe('warn');
        expect(records[0]!.msg).toContain('every declared detent was invalid');

        // Resolution runs per render — it must not warn per render.
        resolve([{ fraction: 1.5 }], ENV);
        expect(records).toHaveLength(1);

        core.clearTransports();
    });
});
