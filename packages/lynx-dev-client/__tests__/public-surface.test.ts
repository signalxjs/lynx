/**
 * Public-surface freeze test for @sigx/lynx-dev-client.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports from the barrel is exactly what we
 *    expect (type-only exports don't exist at runtime, so they're pinned by
 *    the `expectTypeOf` block instead).
 *  - Types: the load-bearing shapes are pinned. This package's contract is
 *    consumed by `@sigx/lynx-plugin`, which injects `./install` into every dev
 *    bundle — a silent signature change here breaks every dev build, not just
 *    app code that imports the package deliberately.
 *
 * `src/install.ts` is deliberately NOT imported: it is a side-effect-only
 * entrypoint (it patches `console` and attaches a WebSocket) and exports no
 * values, so importing it here would install the streamer into the test run.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as devClient from '../src/index.js';
import { installConsoleStreamer, serializeArg } from '../src/index.js';
import type { InstallOptions, LogEntry, LogLevel, Uninstall } from '../src/index.js';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(devClient).sort()).toEqual(
            ['DEV_CLIENT_VERSION', 'installConsoleStreamer', 'serializeArg'].sort(),
        );
    });
});

describe('public types', () => {
    it('keeps the streamer installer returning a teardown (C7)', () => {
        // `installConsoleStreamer` is the one subscription-shaped API here: the
        // return value has to stay a callable teardown, because the plugin and
        // the tests both rely on being able to unpatch `console`.
        expectTypeOf(installConsoleStreamer).toEqualTypeOf<(url: string, opts?: InstallOptions) => Uninstall>();
        expectTypeOf<Uninstall>().toEqualTypeOf<() => void>();
    });

    it('pins serializeArg as a total, synchronous string formatter', () => {
        // Never async and never throwing is the contract — it runs inside the
        // patched `console.*` path, where a rejected promise would be an
        // unhandled rejection on the BG thread.
        expectTypeOf(serializeArg).toEqualTypeOf<(value: unknown, seen?: WeakSet<object>) => string>();
    });

    it('pins the wire format the dev server parses', () => {
        // `LogEntry` is a cross-process contract: the `sigx dev` server decodes
        // exactly these fields, so a rename here is a protocol break that no
        // typecheck of this package alone would catch.
        expectTypeOf<LogEntry>().toEqualTypeOf<{
            level: LogLevel;
            args: string[];
            ts: number;
            platform: string;
        }>();
        expectTypeOf<LogLevel>().toEqualTypeOf<'log' | 'info' | 'warn' | 'error' | 'debug' | 'trace'>();
    });

    it('keeps every install option optional', () => {
        // The plugin calls `installConsoleStreamer(url)` with no options in some
        // paths; promoting any option to required would break that call site.
        expectTypeOf<InstallOptions>().toEqualTypeOf<Partial<InstallOptions>>();
    });

    it('pins the version constant as a string literal', () => {
        // Frozen as `string`-assignable rather than a specific literal so a
        // routine version bump doesn't fail CI; what matters is that it stays a
        // plain string constant and doesn't become an object or a getter.
        expectTypeOf<typeof devClient.DEV_CLIENT_VERSION>().toExtend<string>();
    });
});
