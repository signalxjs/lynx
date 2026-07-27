/**
 * The RESTORE half of the keyboard-height memory (#811): a value persisted by
 * a previous app run seeds the module before any keyboard has been shown, so
 * the first keyboard-sized panel of a fresh launch is already the right size.
 *
 * Separate file because the restore fires once at module load — it needs
 * `loadString` mocked to resolve a value BEFORE the module is imported, which
 * the sibling suite (which pins the no-storage behaviour) can't also do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { component } from '@sigx/lynx';

const insets = { keyboard: 0, bottom: 24, top: 0, left: 0, right: 0 };
vi.mock('@sigx/lynx-safe-area', () => ({
    useSafeAreaInsets: () => ({ get value() { return insets; } }),
}));

// A previous run persisted 344 px.
const saved: Array<[string, string]> = [];
vi.mock('../src/persistence.js', () => ({
    loadString: () => Promise.resolve('344'),
    saveString: (k: string, v: string) => { saved.push([k, v]); },
}));

const { rememberedKeyboardLift, resetRememberedKeyboardLift, useKeyboardLift } =
    await import('../src/use-keyboard');

/** Let the module-load restore promise settle. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function readLift(): number {
    let out = 0;
    const Host = component(() => {
        const lift = useKeyboardLift();
        return () => { out = lift.value; return null; };
    });
    render(<Host />);
    return out;
}

describe('remembered keyboard lift — restored from a previous run', () => {
    beforeEach(() => {
        insets.keyboard = 0;
        saved.length = 0;
    });

    it('seeds the memory from storage before any keyboard is shown', async () => {
        await settle();
        // No keyboard has appeared this run, yet a panel can already size
        // itself correctly — the whole point of persisting.
        expect(rememberedKeyboardLift()).toBe(344);
    });

    it('a REAL observation supersedes the restored value, even if SHORTER', async () => {
        await settle();
        expect(rememberedKeyboardLift()).toBe(344);

        // This run's keyboard is genuinely shorter (numeric layout, no
        // suggestion strip, a different IME). Keeping the taller restored
        // value would strand a panel too tall.
        insets.keyboard = 300;
        expect(readLift()).toBe(276);
        expect(rememberedKeyboardLift()).toBe(276);
        expect(saved.at(-1)).toEqual(['sigx.keyboard.lift', '276']);
    });

    it('resetRememberedKeyboardLift clears whatever is remembered', async () => {
        // NOT asserted against 344: the restore fires once at module load,
        // so by this point an earlier test's real observation may already
        // have superseded it. What matters is that reset empties it.
        await settle();
        expect(rememberedKeyboardLift()).toBeGreaterThan(0);
        resetRememberedKeyboardLift();
        expect(rememberedKeyboardLift()).toBe(0);
    });
});
