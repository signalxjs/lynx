/**
 * Public-surface freeze test for @sigx/lynx-sqlite.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-clipboard/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The
 *    type-only exports (`Migration`, `QueryResult`, `LiveQueryState`, …) are
 *    erased at runtime and are pinned below instead.
 *  - Types: the load-bearing signatures — synchronous `isAvailable` (C2), the
 *    unsubscribe-returning `onChange` (C7), and the `Computed` return of the
 *    `useLiveQuery` hook (C8), which is what makes a screen re-render.
 *
 * `SQLiteDatabase` is a class, so its methods live on the prototype and never
 * show up in an `Object.keys` snapshot; the type pins below are the only thing
 * standing between a renamed method and a broken consumer.
 *
 * Note: this package has no `.web.ts` sibling (the native handle is bridge-only
 * until a sqlite-wasm backend lands), so there is no web-parity block (D7.1b)
 * to assert.
 */
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

// The barrel pulls in `@sigx/lynx` for the hook's reactivity primitives; this
// test only inspects shapes, so a stub keeps it off the real runtime.
vi.mock('@sigx/lynx', () => ({
    signal: vi.fn(),
    computed: vi.fn(),
    onUnmounted: vi.fn(),
}));

import * as sqlite from '../src/index';
import { SQLiteDatabase, deleteDatabase, isAvailable, openDatabase, useLiveQuery } from '../src/index';
import type {
    LiveQueryOptions,
    LiveQueryState,
    Migration,
    OpenOptions,
    QueryResult,
    SQLStatement,
    SQLValue,
    SQLiteRow,
    SQLiteTransaction,
} from '../src/index';
import type { Computed } from '@sigx/reactivity';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(sqlite).sort()).toEqual(
            [
                // database lifecycle
                'SQLiteDatabase',
                'openDatabase',
                'deleteDatabase',
                'isAvailable',
                // BG-reactive query hook
                'useLiveQuery',
            ].sort(),
        );
    });

    it('keeps the documented methods on the database class', () => {
        // Prototype methods are invisible to the snapshot above, so a rename
        // would otherwise sail through both layers of this file.
        expect(Object.getOwnPropertyNames(SQLiteDatabase.prototype).sort()).toEqual(
            [
                'constructor',
                'close',
                'execute',
                'executeBatch',
                'migrate',
                'onChange',
                'transaction',
            ].sort(),
        );
    });
});

describe('public types', () => {
    it('keeps isAvailable synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()` drifted
        // into returning a Promise, which makes `if (isAvailable())` silently
        // always true.
        expectTypeOf(isAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(isAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('pins the lifecycle signatures', () => {
        // `openDatabase` returning the *shared* instance is why `options` is
        // optional and why the return is a promise of the class itself rather
        // than an interface — consumers pass it straight to `useLiveQuery`.
        expectTypeOf(openDatabase).toEqualTypeOf<
            (name: string, options?: OpenOptions) => Promise<SQLiteDatabase>
        >();
        expectTypeOf(deleteDatabase).toEqualTypeOf<(name: string) => Promise<void>>();
    });

    it('pins the statement runner and its result envelope', () => {
        const db = {} as SQLiteDatabase;
        expectTypeOf(db.execute<{ id: number }>).toEqualTypeOf<
            (sql: string, params?: readonly SQLValue[]) => Promise<QueryResult<{ id: number }>>
        >();
        expectTypeOf(db.executeBatch).toEqualTypeOf<
            (statements: readonly SQLStatement[]) => Promise<{ rowsAffected: number }>
        >();
        expectTypeOf(db.migrate).toEqualTypeOf<(migrations: readonly Migration[]) => Promise<void>>();
        expectTypeOf<QueryResult>().toEqualTypeOf<{
            rows: SQLiteRow[];
            rowsAffected: number;
            insertId: number | null;
        }>();
        // The transaction callback only ever gets `execute` — widening it to the
        // full database would legalise the documented deadlock (a nested
        // `db.execute` queues behind the transaction awaiting it).
        expectTypeOf<SQLiteTransaction>().toEqualTypeOf<{
            execute<R = SQLiteRow>(sql: string, params?: readonly SQLValue[]): Promise<QueryResult<R>>;
        }>();
    });

    it('returns an unsubscribe from onChange (C7)', () => {
        const db = {} as SQLiteDatabase;
        expectTypeOf(db.onChange).toEqualTypeOf<
            (
                tables: readonly string[] | ReadonlySet<string> | '*',
                listener: (changed: ReadonlySet<string> | '*') => void,
            ) => () => void
        >();
    });

    it('keeps useLiveQuery reactive (C8)', () => {
        // A `Computed` is the contract: returning a plain snapshot would type-
        // check at every call site and silently stop re-rendering on writes.
        expectTypeOf(useLiveQuery<{ id: number }>).toEqualTypeOf<
            (
                db: SQLiteDatabase | Promise<SQLiteDatabase>,
                sql: string,
                params?: readonly SQLValue[],
                options?: LiveQueryOptions,
            ) => Computed<LiveQueryState<{ id: number }>>
        >();
        // `loading` and `error` are part of the surface: consumers render a
        // spinner off the first and keep the previous rows on the second.
        expectTypeOf<LiveQueryState>().toEqualTypeOf<{
            rows: SQLiteRow[];
            loading: boolean;
            error: Error | null;
        }>();
    });
});
