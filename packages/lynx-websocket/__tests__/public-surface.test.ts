/**
 * Public-surface freeze test for @sigx/lynx-websocket.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The
 *    barrel deliberately does not re-export `__internal` from
 *    `websocket.ts` — that is the test-only escape hatch, and this snapshot
 *    is what keeps it out of the public surface.
 *  - Types: the load-bearing signatures. This package's contract is the
 *    WHATWG `WebSocket` interface, so the pins are the shapes portable web
 *    code depends on (constructor, `send`, `close`, `readyState`), plus the
 *    availability check that `CONVENTIONS.md` C2 constrains.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as websocket from '../src/index';
import { WebSocket, isWebSocketAvailable } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(websocket).sort()).toEqual(['WebSocket', 'isWebSocketAvailable'].sort());
    });

    it('keeps the ready-state constants on the class (WHATWG statics)', () => {
        // Portable code reads `WebSocket.OPEN` rather than the literal 1;
        // dropping these statics silently breaks it at runtime only.
        expect(Object.keys(WebSocket).sort()).toEqual(
            ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].sort(),
        );
    });
});

describe('public types', () => {
    it('keeps the availability check synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true. Frozen as-is under the package-specific name
        // `isWebSocketAvailable` — it is a bare root export rather than the
        // C2 namespace method, because the package's namespace slot is taken
        // by the WHATWG class.
        expectTypeOf(isWebSocketAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(isWebSocketAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins the WHATWG constructor signature', () => {
        // `new WebSocket(url)` and `new WebSocket(url, protocols)` are the
        // two call shapes every portable snippet uses; a required second
        // parameter or a dropped array form would break them all.
        expectTypeOf<ConstructorParameters<typeof WebSocket>>().toEqualTypeOf<
            [url: string, protocols?: string | string[]]
        >();
        expectTypeOf<InstanceType<typeof WebSocket>>().toEqualTypeOf<WebSocket>();
    });

    it('pins send/close as void-returning, not promise-returning', () => {
        // The bridge call is fire-and-forget by design: failures arrive as
        // `error`/`close` events, not as a rejected promise. Returning a
        // Promise here would invite `await ws.send(...)` and float unhandled
        // rejections into consumer code.
        expectTypeOf<WebSocket['send']>().toEqualTypeOf<
            (data: string | ArrayBuffer | ArrayBufferView) => void
        >();
        expectTypeOf<WebSocket['close']>().toEqualTypeOf<(code?: number, reason?: string) => void>();
    });

    it('pins readyState and binaryType as the narrow literal unions', () => {
        // `readyState` widening to `number` would kill exhaustive switches
        // and comparisons against `WebSocket.OPEN`; `binaryType` is
        // deliberately narrower than the browser's ('blob' is unsupported),
        // so widening it would type-check code that fails at runtime.
        expectTypeOf<WebSocket['readyState']>().toEqualTypeOf<0 | 1 | 2 | 3>();
        expectTypeOf<WebSocket['binaryType']>().toEqualTypeOf<'arraybuffer'>();
        expectTypeOf<(typeof WebSocket)['OPEN']>().toEqualTypeOf<1>();
    });

    it('keeps the EventTarget pair symmetric and void-returning', () => {
        // Deliberately not C7: WHATWG `addEventListener` returns void, and
        // the unsubscribe is `removeEventListener`. Frozen as the standard
        // shape — returning a disposer here would diverge from the browser
        // API this package exists to emulate.
        expectTypeOf<WebSocket['addEventListener']>().parameters.toEqualTypeOf<
            Parameters<WebSocket['removeEventListener']>
        >();
        expectTypeOf<ReturnType<WebSocket['addEventListener']>>().toEqualTypeOf<void>();
        expectTypeOf<ReturnType<WebSocket['removeEventListener']>>().toEqualTypeOf<void>();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps websocket.web.js in by extensionAlias (#697), so
        // an export added to one and not the other is a runtime failure on
        // the target that missed it — invisible to a normal typecheck.
        const web = await import('../src/websocket.web');
        expect(Object.keys(web).sort()).toEqual(Object.keys(websocket).sort());
    });
});
