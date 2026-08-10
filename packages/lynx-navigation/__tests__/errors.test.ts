/**
 * Error shape + diagnostics (convention C10).
 *
 * Two things are pinned here because both are contracts consumers rely on:
 * the `[@sigx/lynx-navigation] <action> failed: <detail>` message prefix, and
 * the `code` a caller branches on (message text is explicitly *not* stable).
 * Deep-link handlers are the motivating case — resolving a URL from outside
 * the app has to tell "unknown route" from "params didn't validate".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addTransport, clearTransports, isSigxError, type LogRecord } from '@sigx/lynx-core';
import { compilePath } from '../src/url/compile';
import { _clearRouteRegistry, _setRouteRegistry } from '../src/url/registry';
import { hrefFor } from '../src/href';
import { wireHardwareBack } from '../src/hooks/use-hardware-back';
import type { Nav } from '../src/hooks/use-nav';
import type { StandardSchemaV1 } from '../src/types';

/** Standard Schema that always rejects, to drive the validation failures. */
const failingSchema = {
    '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: () => ({ issues: [{ message: 'id must be a string' }] }),
    },
} as unknown as StandardSchemaV1;

function codeOf(fn: () => unknown): string {
    try {
        fn();
    } catch (e) {
        if (!isSigxError(e)) throw new Error(`expected a SigxError, got ${String(e)}`);
        expect(e.package).toBe('lynx-navigation');
        expect(e.message).toMatch(/^\[@sigx\/lynx-navigation\] .+ failed: /);
        return e.code;
    }
    throw new Error('expected the call to throw');
}

describe('error codes', () => {
    afterEach(() => { _clearRouteRegistry(); });

    it('tags an unresolvable route name', () => {
        _setRouteRegistry({ home: { component: () => null } } as never);
        expect(codeOf(() => hrefFor('nope' as never))).toBe('route_not_registered');
    });

    it('tags params and search validation apart', () => {
        _setRouteRegistry({
            profile: { component: () => null, params: failingSchema },
            list: { component: () => null, search: failingSchema },
        } as never);
        expect(codeOf(() => hrefFor('profile' as never, { id: 1 } as never)))
            .toBe('invalid_params');
        expect(codeOf(() => hrefFor('list' as never, { q: 1 } as never)))
            .toBe('invalid_search');
    });

    it('tags a missing registry', () => {
        _clearRouteRegistry();
        expect(codeOf(() => hrefFor('home' as never))).toBe('no_route_registry');
    });

    it('tags a malformed path template', () => {
        expect(codeOf(() => compilePath('/users/:id/x/:id'))).toBe('invalid_path');
        expect(codeOf(() => compilePath(''))).toBe('invalid_path');
        expect(codeOf(() => compilePath('/users/:id').format({}))).toBe('invalid_path');
    });

    it('keeps a wrong-typed template a TypeError, prefixed', () => {
        expect(() => compilePath(42 as never)).toThrow(TypeError);
        expect(() => compilePath(42 as never)).toThrow(
            /^\[@sigx\/lynx-navigation\] compilePath failed: expected a string template/,
        );
    });
});

// ---------------------------------------------------------------------------
// Fire-and-forget bridge calls must consume their rejection (D3.7 / #863).
// ---------------------------------------------------------------------------

interface MockEmitter {
    addListener: (name: string, fn: () => void) => void;
    removeListener: (name: string, fn: () => void) => void;
    fire: (name: string) => void;
}

describe('exitApp diagnostics', () => {
    let records: LogRecord[];
    let emitter: MockEmitter;

    beforeEach(() => {
        records = [];
        addTransport((r) => records.push(r));
        const listeners = new Map<string, Set<() => void>>();
        emitter = {
            addListener(name, fn) {
                let set = listeners.get(name);
                if (!set) { set = new Set(); listeners.set(name, set); }
                set.add(fn);
            },
            removeListener(name, fn) { listeners.get(name)?.delete(fn); },
            fire(name) { for (const fn of listeners.get(name) ?? []) fn(); },
        };
        (globalThis as { lynx?: unknown }).lynx = {
            getJSModule: (name: string) => (name === 'GlobalEventEmitter' ? emitter : undefined),
        };
    });

    afterEach(() => {
        clearTransports();
        delete (globalThis as { lynx?: unknown }).lynx;
    });

    it('logs the rejection instead of leaving it unhandled', async () => {
        // Nothing to pop anywhere in the tree, so the press escalates to
        // `BackHandler.exitApp()` — which rejects here (no native module),
        // exactly as it does on iOS by design.
        const nav = {
            parent: null,
            _children: new Set<Nav>(),
            isLocallyFocused: true,
            canGoBack: false,
            pop() {},
        } as unknown as Nav;
        const dispose = wireHardwareBack(nav);

        emitter.fire('hardwareBackPress');
        // One turn for the rejected bridge promise to reach the `.catch`.
        await Promise.resolve();
        await Promise.resolve();

        expect(records.map((r) => r.msg)).toContain('exitApp failed');
        expect(records.find((r) => r.msg === 'exitApp failed')?.namespace)
            .toBe('lynx-navigation');
        dispose();
    });
});
