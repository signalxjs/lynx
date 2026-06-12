import { callAsync, isModuleAvailable } from '@sigx/lynx-core';
import { runMigrations } from './migrations.js';
import { writtenTables } from './table-names.js';
import type {
    Migration,
    OpenOptions,
    QueryResult,
    SQLStatement,
    SQLValue,
    SQLiteRow,
    SQLiteTransaction,
} from './types.js';

const MODULE = 'Sqlite';
const TAG = '[@sigx/lynx-sqlite]';

function fail(message: string): never {
    throw new Error(`${TAG} ${message}`);
}

/** Native callbacks resolve with the value on success, `{ error }` on failure. */
function unwrap<T>(result: unknown): T {
    const err = (result as { error?: unknown } | null)?.error;
    if (typeof err === 'string') fail(err);
    return result as T;
}

/**
 * Coerce JS params to what the native side binds: string | number | null.
 * Booleans become 1/0, `undefined` becomes NULL; everything else (objects,
 * ArrayBuffers, Dates, …) is rejected before touching the bridge.
 */
function normalizeParams(params: readonly SQLValue[] | undefined): (string | number | null)[] {
    if (!params || params.length === 0) return [];
    return params.map((p, i) => {
        if (p === null || p === undefined) return null;
        switch (typeof p) {
            case 'string':
                return p;
            case 'number':
                if (!Number.isFinite(p)) fail(`parameter ${i + 1} is not a finite number`);
                return p;
            case 'boolean':
                return p ? 1 : 0;
            default:
                return fail(
                    `parameter ${i + 1} has unsupported type "${typeof p}" — bind ` +
                    `string | number | boolean | null. BLOBs are not supported in v1: ` +
                    `store a file path (see @sigx/lynx-file-system) or base64 TEXT instead.`,
                );
        }
    });
}

type ChangedTables = ReadonlySet<string> | '*';
type ChangeListener = (changed: ChangedTables) => void;
interface Subscription {
    tables: ReadonlySet<string> | '*';
    fn: ChangeListener;
}

/** One shared instance per database name — see `openDatabase`. */
const registry = new Map<string, SQLiteDatabase>();
const opening = new Map<string, Promise<SQLiteDatabase>>();

// The native handle is module-internal: nothing outside this file should
// talk to the bridge directly, so a future web (sqlite-wasm) backend only
// has to swap this file's internals.
export class SQLiteDatabase {
    readonly name: string;
    #handle: number;
    #closed = false;
    /**
     * Serializes operations so an open `transaction()` is never interleaved
     * with foreign statements: native runs one statement at a time per
     * handle, and this queue admits one *operation* (which may span many
     * statements) at a time.
     */
    #queue: Promise<unknown> = Promise.resolve();
    #subs = new Set<Subscription>();

    /** @internal — use `openDatabase()` */
    constructor(name: string, handle: number) {
        this.name = name;
        this.#handle = handle;
    }

    #enqueue<T>(op: () => Promise<T>): Promise<T> {
        const run = this.#queue.then(op, op); // run regardless of the previous op's outcome
        this.#queue = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }

    #assertOpen(): void {
        if (this.#closed) fail(`database "${this.name}" is closed`);
    }

    async #rawExecute<R>(sql: string, params?: readonly SQLValue[]): Promise<QueryResult<R>> {
        if (typeof sql !== 'string' || sql.trim() === '') fail('sql must be a non-empty string');
        const result = unwrap<{ rows?: R[]; rowsAffected?: number; insertId?: number }>(
            await callAsync(MODULE, 'execute', this.#handle, sql, normalizeParams(params)),
        );
        return {
            rows: result.rows ?? [],
            rowsAffected: result.rowsAffected ?? 0,
            insertId: result.insertId ?? null,
        };
    }

    /** Run one statement. SELECTs return rows; writes return rowsAffected/insertId. */
    async execute<R = SQLiteRow>(sql: string, params?: readonly SQLValue[]): Promise<QueryResult<R>> {
        this.#assertOpen();
        return this.#enqueue(async () => {
            const result = await this.#rawExecute<R>(sql, params);
            const written = writtenTables(sql);
            if (written) this.#notify(written);
            return result;
        });
    }

    /** All statements in one native call and ONE transaction — all-or-nothing. */
    async executeBatch(statements: readonly SQLStatement[]): Promise<{ rowsAffected: number }> {
        this.#assertOpen();
        if (statements.length === 0) return { rowsAffected: 0 };
        const written = new Set<string>();
        let wildcard = false;
        const payload = statements.map(([sql, params]) => {
            if (typeof sql !== 'string' || sql.trim() === '') fail('sql must be a non-empty string');
            const w = writtenTables(sql);
            if (w === '*') wildcard = true;
            else if (w) for (const t of w) written.add(t);
            return { sql, params: normalizeParams(params) };
        });
        return this.#enqueue(async () => {
            const result = unwrap<{ rowsAffected?: number }>(
                await callAsync(MODULE, 'executeBatch', this.#handle, payload),
            );
            if (wildcard) this.#notify('*');
            else if (written.size > 0) this.#notify(written);
            return { rowsAffected: result.rowsAffected ?? 0 };
        });
    }

    /**
     * Interactive transaction. Rolls back if `fn` throws; other calls on
     * this database queue behind it. Change notifications for everything
     * written inside fire once, on commit — never on rollback.
     */
    async transaction<T>(fn: (tx: SQLiteTransaction) => Promise<T>): Promise<T> {
        this.#assertOpen();
        return this.#enqueue(async () => {
            unwrap(await callAsync(MODULE, 'beginTransaction', this.#handle));
            const touched = new Set<string>();
            let wildcard = false;
            const tx: SQLiteTransaction = {
                execute: async <R = SQLiteRow>(sql: string, params?: readonly SQLValue[]) => {
                    const result = await this.#rawExecute<R>(sql, params);
                    const w = writtenTables(sql);
                    if (w === '*') wildcard = true;
                    else if (w) for (const t of w) touched.add(t);
                    return result;
                },
            };
            try {
                const value = await fn(tx);
                unwrap(await callAsync(MODULE, 'commit', this.#handle));
                if (wildcard) this.#notify('*');
                else if (touched.size > 0) this.#notify(touched);
                return value;
            } catch (e) {
                try {
                    unwrap(await callAsync(MODULE, 'rollback', this.#handle));
                } catch {
                    // surface the original error, not the rollback failure
                }
                throw e;
            }
        });
    }

    /** Apply pending `PRAGMA user_version`-based migrations. See `Migration`. */
    migrate(migrations: readonly Migration[]): Promise<void> {
        return runMigrations(this, migrations);
    }

    /**
     * Subscribe to write notifications for `tables` (`'*'` = any write).
     * Only writes made through this API notify — another process or native
     * code touching the same file does not. Returns an unsubscribe function.
     */
    onChange(tables: readonly string[] | ReadonlySet<string> | '*', listener: ChangeListener): () => void {
        const sub: Subscription = {
            tables: tables === '*' ? '*' : new Set([...tables].map((t) => t.toLowerCase())),
            fn: listener,
        };
        this.#subs.add(sub);
        return () => {
            this.#subs.delete(sub);
        };
    }

    #notify(changed: ChangedTables): void {
        for (const sub of this.#subs) {
            const matches =
                changed === '*' ||
                sub.tables === '*' ||
                [...changed].some((t) => (sub.tables as ReadonlySet<string>).has(t));
            if (!matches) continue;
            try {
                sub.fn(changed);
            } catch (e) {
                // A throwing listener must not reject the write that
                // triggered it (the writer did nothing wrong).
                console.error(`${TAG} onChange listener threw:`, e);
            }
        }
    }

    /** Close the handle. Subsequent calls on this instance reject. */
    async close(): Promise<void> {
        this.#assertOpen();
        this.#closed = true; // calls made from here on fail fast
        registry.delete(this.name);
        return this.#enqueue(async () => {
            unwrap(await callAsync(MODULE, 'close', this.#handle));
            this.#subs.clear();
        });
    }
}

/**
 * Open (or create) a database in the app's data directory. The same `name`
 * returns the same shared instance — one handle, one operation queue, one
 * change bus — so live queries see writes from every screen.
 */
export async function openDatabase(name: string, options: OpenOptions = {}): Promise<SQLiteDatabase> {
    if (typeof name !== 'string' || !/^[A-Za-z0-9._-]+$/.test(name)) {
        fail('database name must be a plain file name (letters, digits, ".", "_", "-")');
    }
    const existing = registry.get(name);
    if (existing) return existing;
    const pending = opening.get(name);
    if (pending) return pending;
    const open = (async () => {
        try {
            const result = unwrap<{ handle?: number }>(await callAsync(MODULE, 'open', name, options));
            if (typeof result.handle !== 'number') fail('native open returned no handle');
            const db = new SQLiteDatabase(name, result.handle);
            registry.set(name, db);
            return db;
        } finally {
            opening.delete(name);
        }
    })();
    opening.set(name, open);
    return open;
}

/**
 * Delete a database file (including its WAL/SHM sidecars). The database
 * must not be open — `close()` it first.
 */
export async function deleteDatabase(name: string): Promise<void> {
    if (registry.has(name) || opening.has(name)) {
        fail(`database "${name}" is open — close() it before deleting`);
    }
    unwrap(await callAsync(MODULE, 'deleteDatabase', name));
}

/** Whether the native Sqlite module is registered in this runtime. */
export function isAvailable(): boolean {
    return isModuleAvailable(MODULE);
}
