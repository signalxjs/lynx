/**
 * Detent resolution — declared specs → ascending px heights. This is the
 * math the showcase EmojiComposer used to hand-roll (keyboard height +
 * bottom-inset add-back, header caps, ascending guarantees), locked down
 * as the package's contract.
 */
import { describe, expect, it } from 'vitest';
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
