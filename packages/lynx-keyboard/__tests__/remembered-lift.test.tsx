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
// and these tests pin the in-memory half of the contract. `saveString` is a
// fire-and-forget no-op here; `loadString` never resolves a value.
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
        expect(readLift()).toBe(0);
        expect(rememberedKeyboardLift()).toBe(344);
    });

    it('keeps the running MAX across keyboards of different heights', () => {
        insets.keyboard = 368;
        readLift();
        insets.keyboard = 300;           // e.g. a numeric IME
        readLift();
        expect(rememberedKeyboardLift()).toBe(344);
    });

    it('persists the height so a fresh app run starts out right', () => {
        insets.keyboard = 368;
        readLift();
        expect(saved.at(-1)).toEqual(['sigx.keyboard.lift', '344']);
    });

    it('a REAL observation supersedes a restored guess, even if shorter', () => {
        // Last run's keyboard may be taller than this run's (different IME,
        // split screen) — keeping the stale max would strand a panel too
        // tall, so the first real reading replaces it outright.
        resetRememberedKeyboardLift();
        insets.keyboard = 300;
        readLift();
        expect(rememberedKeyboardLift()).toBe(276);
    });

    it('only records the DEFAULT lift shape, so the number means one thing', () => {
        insets.keyboard = 368;
        readLift(false);                 // undiscounted
        readLift(true, 50);              // offset
        expect(rememberedKeyboardLift()).toBe(0);
    });
});
