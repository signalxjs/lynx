/**
 * Native clipboard surface — the path that ships on iOS and Android.
 *
 * Only the web shim was covered before, so the code that actually runs on
 * device had no tests at all. These drive the real `@sigx/lynx-core` bridge
 * against a faked `NativeModules` global, so the module-name and callback
 * conventions are exercised rather than mocked away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Clipboard } from '../src/clipboard';

/** Records what crossed the bridge, so call shape is asserted, not assumed. */
let calls: Array<{ method: string; args: unknown[] }>;

/** Install a fake `Clipboard` native module. `undefined` unlinks it. */
function installNativeModules(impl?: Record<string, (...a: never[]) => unknown>) {
    vi.stubGlobal('NativeModules', impl ? { Clipboard: impl } : {});
}

beforeEach(() => {
    calls = [];
    installNativeModules({
        setString: (...args: never[]) => {
            calls.push({ method: 'setString', args });
        },
        getString: (...args: never[]) => {
            calls.push({ method: 'getString', args });
            (args[0] as unknown as (v: string) => void)('clipboard text');
        },
        hasString: (...args: never[]) => {
            calls.push({ method: 'hasString', args });
            (args[0] as unknown as (v: boolean) => void)(true);
        },
    });
});

afterEach(() => vi.unstubAllGlobals());

describe('Clipboard.setString', () => {
    it('writes synchronously and returns nothing', () => {
        expect(Clipboard.setString('copy me')).toBeUndefined();
        expect(calls).toEqual([{ method: 'setString', args: ['copy me'] }]);
    });

    it('passes an empty string through rather than dropping the call', () => {
        // Clearing the clipboard is a real use; both native sides coalesce
        // null to "", so the empty write must actually reach them.
        Clipboard.setString('');
        expect(calls).toEqual([{ method: 'setString', args: [''] }]);
    });
});

describe('Clipboard.getString', () => {
    it('resolves the value the native callback supplies', async () => {
        await expect(Clipboard.getString()).resolves.toBe('clipboard text');
        expect(calls[0]!.method).toBe('getString');
    });

    it('resolves an empty clipboard as an empty string, not a rejection', () => {
        // Both native modules coalesce a missing clip to "" — an empty
        // clipboard is a normal state, not an error.
        installNativeModules({ getString: (cb: never) => (cb as unknown as (v: string) => void)('') });
        return expect(Clipboard.getString()).resolves.toBe('');
    });
});

describe('Clipboard.hasString', () => {
    it('resolves the native boolean', async () => {
        await expect(Clipboard.hasString()).resolves.toBe(true);
    });

    it('resolves false for an empty clipboard', () => {
        installNativeModules({ hasString: (cb: never) => (cb as unknown as (v: boolean) => void)(false) });
        return expect(Clipboard.hasString()).resolves.toBe(false);
    });
});

describe('Clipboard.isAvailable', () => {
    it('is true when the module is linked', () => {
        expect(Clipboard.isAvailable()).toBe(true);
    });

    it('is false when it is not', () => {
        installNativeModules();
        expect(Clipboard.isAvailable()).toBe(false);
    });

    it('is false, not a throw, with no NativeModules global at all', () => {
        // Off-device — web preview, SSR, tests. Feature detection has to work
        // there or every caller needs a try/catch.
        vi.unstubAllGlobals();
        expect(Clipboard.isAvailable()).toBe(false);
    });

    it('returns a boolean synchronously (C2)', () => {
        // C2: `isAvailable` answers "is the module linked?" and is always sync.
        // A Promise here would make `if (Clipboard.isAvailable())` always true.
        expect(typeof Clipboard.isAvailable()).toBe('boolean');
    });
});

describe('when the native module is not linked', () => {
    // C3: this package throws rather than silently no-op'ing, and the error is
    // the descriptive one from core's `getModule`. The README documents it.
    beforeEach(() => installNativeModules());

    it('setString throws with an actionable message', () => {
        expect(() => Clipboard.setString('x')).toThrow(/Module "Clipboard" is not available/);
    });

    it('getString rejects rather than hanging', async () => {
        // callAsync catches the synchronous getModule throw and rejects, so a
        // caller awaiting it gets an error instead of a promise that never
        // settles.
        await expect(Clipboard.getString()).rejects.toThrow(/Module "Clipboard" is not available/);
    });

    it('hasString rejects', async () => {
        await expect(Clipboard.hasString()).rejects.toThrow(/Module "Clipboard" is not available/);
    });
});
