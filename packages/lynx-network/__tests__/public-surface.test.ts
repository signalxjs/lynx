/**
 * Public-surface freeze test for @sigx/lynx-network.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`ConnectionType`, `NetworkState`) are erased at runtime and are
 *    pinned below instead.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — `isAvailable` has to stay synchronous (C2),
 *    and `NetworkState` is the shape every consumer destructures.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as network from '../src/index';
import { Network } from '../src/index';
import type { ConnectionType, NetworkState } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(network).sort()).toEqual(['Network']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(Network).sort()).toEqual(['getState', 'isAvailable']);
    });
});

describe('public types', () => {
    it('pins the method signatures', () => {
        expectTypeOf(Network.getState).toEqualTypeOf<() => Promise<NetworkState>>();
    });

    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(Network.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Network.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins the state envelope consumers destructure', () => {
        // `isInternetReachable` is deliberately nullable: `null` means "the
        // platform has no reachability probe", which is not the same as
        // "unreachable". Collapsing it to `boolean` would make offline banners
        // fire on platforms that simply cannot answer.
        expectTypeOf<NetworkState>().toEqualTypeOf<{
            isConnected: boolean;
            type: ConnectionType;
            isInternetReachable: boolean | null;
        }>();
        expectTypeOf<ConnectionType>().toEqualTypeOf<
            'wifi' | 'cellular' | 'ethernet' | 'bluetooth' | 'none' | 'unknown'
        >();
    });
});

describe('web implementation', () => {
    it('has the same surface as the native one', async () => {
        // The plugin swaps network.web.js in by extensionAlias (#697), so a
        // method added to one and not the other is a runtime failure on the
        // target that missed it — invisible to a normal typecheck.
        const web = await import('../src/network.web');
        expect(Object.keys(web.Network).sort()).toEqual(Object.keys(Network).sort());
    });
});
