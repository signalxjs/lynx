/**
 * Session-level keyboard-height memory (#811).
 *
 * "How tall is this device's keyboard" is a fact about the app's
 * environment, not about whichever component was mounted when it last
 * appeared — a keyboard-sized panel opening on a screen where nothing has
 * been typed yet would otherwise guess a fallback and then visibly correct
 * itself when the real keyboard returned.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { component } from '@sigx/lynx';

const insets = { keyboard: 0, bottom: 24, top: 0, left: 0, right: 0 };
vi.mock('@sigx/lynx-safe-area', () => ({
    useSafeAreaInsets: () => ({ get value() { return insets; } }),
}));

// Persistence is an OPTIONAL peer — the memory must work per-run without it,
// and these tests pin exactly that half of the contract: `loadString` never
// resolves a value, so nothing here exercises the restore path. That half
// lives in `remembered-lift-restore.test.tsx`, which needs the opposite mock
// before module load and therefore its own file.
const saved: Array<[string, string]> = [];
vi.mock('../src/persistence.js', () => ({
    loadString: () => Promise.resolve(null),
    saveString: (k: string, v: string) => { saved.push([k, v]); },
}));

const { rememberedKeyboardLift, resetRememberedKeyboardLift, useKeyboardLift } =
    await import('../src/use-keyboard');

/** Read the lift once, the way a consumer's render would. */
function readLift(discount = true, offset = 0): number {
    let out = 0;
    const Host = component(() => {
        const lift = useKeyboardLift(discount, offset);
        return () => { out = lift.value; return null; };
    });
    render(<Host />);
    return out;
}

describe('rememberedKeyboardLift', () => {
    beforeEach(() => {
        resetRememberedKeyboardLift();
        insets.keyboard = 0;
        saved.length = 0;
    });

    it('is 0 until a keyboard has ever been seen', () => {
        expect(rememberedKeyboardLift()).toBe(0);
        readLift();
        expect(rememberedKeyboardLift()).toBe(0);
    });

    it('records the inset-discounted lift once the keyboard shows', () => {
        insets.keyboard = 368;
        expect(readLift()).toBe(344);
        expect(rememberedKeyboardLift()).toBe(344);
    });

    it('SURVIVES the keyboard going away — that is the whole point', () => {
        insets.keyboard = 368;
        readLift();
        insets.keyboard = 0;
        expect(readLift()).toBe(0);      // the hook reports no lift…
        expect(rememberedKeyboardLift()).toBe(344);   // …the memory holds
    });

    it('keeps the LATEST height, never a running max', () => {
        // The keyboard is not one height — the suggestion strip comes and
        // goes, numeric and alpha layouts differ. A panel sized to occupy its
        // space must match the keyboard about to appear, and the best
        // predictor is the last one that did. A max latched onto the tallest
        // ever seen and opened the panel too tall from then on.
        insets.keyboard = 368;
        readLift();
        expect(rememberedKeyboardLift()).toBe(344);

        insets.keyboard = 300;           // e.g. a numeric layout, no strip
        readLift();
        expect(rememberedKeyboardLift()).toBe(276);

        insets.keyboard = 368;           // …and back
        readLift();
        expect(rememberedKeyboardLift()).toBe(344);
    });

    it('persists the height so a fresh app run starts out right', () => {
        insets.keyboard = 368;
        readLift();
        expect(saved.at(-1)).toEqual(['sigx.keyboard.lift', '344']);
    });

    it('does not re-write storage for an unchanged height', () => {
        // The record runs from a computed that every mounted lift hook
        // re-evaluates, so an unguarded write turns one keyboard show into a
        // burst of identical setItem calls.
        insets.keyboard = 368;
        readLift();
        readLift();
        readLift();
        expect(saved).toHaveLength(1);

        insets.keyboard = 300;           // a genuinely different height
        readLift();
        expect(saved).toHaveLength(2);
        expect(saved.at(-1)).toEqual(['sigx.keyboard.lift', '276']);
    });

    it('resetRememberedKeyboardLift() clears the session value', () => {
        insets.keyboard = 368;
        readLift();
        expect(rememberedKeyboardLift()).toBe(344);
        resetRememberedKeyboardLift();
        expect(rememberedKeyboardLift()).toBe(0);
    });

    it('only records the DEFAULT lift shape, so the number means one thing', () => {
        insets.keyboard = 368;
        readLift(false);                 // undiscounted
        readLift(true, 50);              // offset
        expect(rememberedKeyboardLift()).toBe(0);
    });
});
