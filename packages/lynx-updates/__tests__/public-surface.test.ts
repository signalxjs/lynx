/**
 * Public-surface freeze test for @sigx/lynx-updates.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. Type-only
 *    exports (`UpdateManifest`, `UpdateProvider`, `UpdatesConfig`, …) are
 *    erased at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures, because those are what
 *    `CONVENTIONS.md` constrains — `isAvailable` has to stay synchronous
 *    (C2), `addListener` has to keep returning a bare unsubscribe (C7), and
 *    `UpdateProvider` is a *consumer-implemented* interface, so any change to
 *    it breaks third-party backends that this repo cannot typecheck.
 *
 * Note: this package has no `.web.ts` sibling — OTA updates are native-only —
 * so there is no web-parity block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as updates from '../src/index';
import { StaticManifestProvider, Updates, UpdatesError, useUpdates } from '../src/index';
import type {
    CurrentUpdateInfo,
    DownloadSpec,
    UpdateCheckContext,
    UpdateCheckResult,
    UpdateManifest,
    UpdatesEvent,
    UpdatesState,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(updates).sort()).toEqual(
            [
                // Namespace facade (C1) — the whole imperative API.
                'Updates',
                // BG-reactive view of the same state machine.
                'useUpdates',
                // Built-in provider backend + the manifest linter the CLI shares.
                'StaticManifestProvider',
                'validateUpdatesManifest',
                // Error class: a value export because consumers `instanceof` it.
                'UpdatesError',
            ].sort(),
        );
    });

    it('exposes exactly the documented Updates methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(Updates).sort()).toEqual([
            'addListener',
            'apply',
            'checkForUpdate',
            'clearUpdates',
            'configure',
            'download',
            'getCurrentlyRunning',
            'getState',
            'isAvailable',
            'markReady',
        ]);
    });
});

describe('public types', () => {
    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes `if (isAvailable())`
        // silently always true.
        expectTypeOf(Updates.isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(Updates.isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins the lifecycle method signatures', () => {
        // `configure` is synchronous on purpose — it must be callable before
        // `defineApp` without awaiting, so returning a Promise would silently
        // change every caller's startup ordering.
        expectTypeOf(Updates.configure).parameter(0).toEqualTypeOf<updates.UpdatesConfig>();
        expectTypeOf(Updates.configure).returns.toEqualTypeOf<void>();
        expectTypeOf(Updates.checkForUpdate).toEqualTypeOf<() => Promise<UpdateCheckResult>>();
        expectTypeOf(Updates.download).toEqualTypeOf<
            (manifest?: UpdateManifest) => Promise<void>
        >();
        expectTypeOf(Updates.apply).toEqualTypeOf<() => Promise<void>>();
        expectTypeOf(Updates.markReady).toEqualTypeOf<() => Promise<void>>();
        expectTypeOf(Updates.clearUpdates).toEqualTypeOf<() => Promise<void>>();
        expectTypeOf(Updates.getCurrentlyRunning).toEqualTypeOf<() => Promise<CurrentUpdateInfo>>();
        expectTypeOf(Updates.getState).toEqualTypeOf<() => UpdatesState>();
    });

    it('keeps addListener returning a bare unsubscribe (C7)', () => {
        // Consumers stash the return value straight into an effect cleanup;
        // widening it to a subscription object would break every call site
        // without changing a single call expression.
        expectTypeOf(Updates.addListener).toEqualTypeOf<
            (fn: (event: UpdatesEvent) => void) => () => void
        >();
    });

    it('keeps useUpdates reactive rather than a snapshot (C8)', () => {
        // The hook contract is a signal: components read `.value` and
        // re-render on transitions. Returning a plain `UpdatesState` would
        // compile at every call site and simply stop updating.
        expectTypeOf(useUpdates()).toHaveProperty('value');
        expectTypeOf(useUpdates().value).toEqualTypeOf<UpdatesState>();
    });

    it('pins the discriminated result and event unions (C5)', () => {
        // `checkForUpdate` never rejects for "nothing to do"; the outcome is
        // the discriminant, and `incompatible` in particular is easy to drop
        // by accident because it looks like an error case.
        expectTypeOf<UpdateCheckResult['type']>().toEqualTypeOf<
            'update-available' | 'up-to-date' | 'incompatible'
        >();
        expectTypeOf<UpdatesEvent['type']>().toEqualTypeOf<
            | 'checkStarted'
            | 'upToDate'
            | 'updateAvailable'
            | 'incompatibleUpdate'
            | 'downloadStarted'
            | 'downloadProgress'
            | 'updateReady'
            | 'applying'
            | 'rolledBack'
            | 'error'
        >();
    });

    it('pins the rollback reason carried by the rolledBack event', () => {
        // The only JS-visible answer to "why did native revert my update" —
        // it comes from the native update store (`getState`), and a consumer
        // reporting crash loops to its error tracker branches on it.
        expectTypeOf<Extract<UpdatesEvent, { type: 'rolledBack' }>['reason']>()
            .toEqualTypeOf<updates.UpdateRollbackReason>();
        expectTypeOf<updates.UpdateRollbackReason>().toEqualTypeOf<'crash' | 'corrupt' | 'unknown'>();
    });

    it('pins the UpdateProvider contract implemented outside this repo', () => {
        // Third-party backends (auth, signed manifests, Expo protocol) live in
        // their own packages, so a change here breaks code CI never sees.
        // `resolveDownload` staying optional is the load-bearing half.
        expectTypeOf<StaticManifestProvider>().toMatchTypeOf<updates.UpdateProvider>();
        expectTypeOf<updates.UpdateProvider['checkForUpdate']>().toEqualTypeOf<
            (ctx: UpdateCheckContext) => Promise<UpdateCheckResult>
        >();
        expectTypeOf<updates.UpdateProvider['resolveDownload']>().toEqualTypeOf<
            | ((manifest: UpdateManifest, ctx: UpdateCheckContext) => Promise<DownloadSpec>)
            | undefined
        >();
    });

    it('keeps UpdatesError carrying a machine-readable code', () => {
        // `error.code` is how apps distinguish "retry later" from "ship a new
        // binary"; a message-only error would make that undecidable.
        expectTypeOf<UpdatesError['code']>().toEqualTypeOf<updates.UpdatesErrorCode>();
        expectTypeOf(new UpdatesError('check-failed', 'x')).toMatchTypeOf<Error>();
        expectTypeOf(updates.validateUpdatesManifest).toEqualTypeOf<(doc: unknown) => string[]>();
    });
});
