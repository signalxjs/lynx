import { callAsync, createLogger, isModuleAvailable, unwrapNative, unwrapNativeVoid } from '@sigx/lynx-core';
import { PKG, fail } from './errors.js';
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
const log = createLogger(PKG);

/**
 * Coerce JS params to what the native side binds: string | number | null.
 * Booleans become 1/0, `undefined` becomes NULL; everything else (objects,
 * ArrayBuffers, Dates, …) is rejected before touching the bridge.
 */
function normalizeParams(
    action: string,
    params: readonly SQLValue[] | undefined,
): (string | number | null)[] {
    if (!params || params.length === 0) return [];
    return params.map((p, i) => {
        if (p === null || p === undefined) return null;
        switch (typeof p) {
            case 'string':
                return p;
            case 'number':
                if (!Number.isFinite(p)) {
                    fail('invalid_param', action, `parameter ${i + 1} is not a finite number`);
                }
                return p;
            case 'boolean':
                return p ? 1 : 0;
            default:
                return fail(
                    'invalid_param',
                    action,
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

/**
 * Database names must be plain file names — both native sides build
 * filesystem paths from them ("." / ".." / separators would escape the
 * app's database directory). Natively re-validated too, since modules are
 * callable without this wrapper.
 */
function validateName(action: string, name: string): void {
    if (
        typeof name !== 'string' ||
        !/^[A-Za-z0-9._-]+$/.test(name) ||
        name === '.' ||
        name === '..'
    ) {
        fail(
            'invalid_database_name',
            action,
            'database name must be a plain file name (letters, digits, ".", "_", "-")',
        );
    }
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

    #assertOpen(action: string): void {
        if (this.#closed) fail('database_closed', action, `database "${this.name}" is closed`);
    }

    async #rawExecute<R>(sql: string, params?: readonly SQLValue[]): Promise<QueryResult<R>> {
        if (typeof sql !== 'string' || sql.trim() === '') {
            fail('invalid_sql', 'execute', 'sql must be a non-empty string');
        }
        const result = unwrapNative<{ rows?: R[]; rowsAffected?: number; insertId?: number }>(
            PKG,
            'execute',
            await callAsync(MODULE, 'execute', this.#handle, sql, normalizeParams('execute', params)),
        );
        return {
            rows: result.rows ?? [],
            rowsAffected: result.rowsAffected ?? 0,
            insertId: result.insertId ?? null,
        };
    }

    /** Run one statement. SELECTs return rows; writes return rowsAffected/insertId. */
    async execute<R = SQLiteRow>(sql: string, params?: readonly SQLValue[]): Promise<QueryResult<R>> {
        this.#assertOpen('execute');
        return this.#enqueue(async () => {
            const result = await this.#rawExecute<R>(sql, params);
            const written = writtenTables(sql);
            if (written) this.#notify(written);
            return result;
        });
    }

    /** All statements in one native call and ONE transaction — all-or-nothing. */
    async executeBatch(statements: readonly SQLStatement[]): Promise<{ rowsAffected: number }> {
        this.#assertOpen('executeBatch');
        if (statements.length === 0) return { rowsAffected: 0 };
        const written = new Set<string>();
        let wildcard = false;
        const payload = statements.map(([sql, params]) => {
            if (typeof sql !== 'string' || sql.trim() === '') {
                fail('invalid_sql', 'executeBatch', 'sql must be a non-empty string');
            }
            const w = writtenTables(sql);
            if (w === '*') wildcard = true;
            else if (w) for (const t of w) written.add(t);
            return { sql, params: normalizeParams('executeBatch', params) };
        });
        return this.#enqueue(async () => {
            const result = unwrapNative<{ rowsAffected?: number }>(
                PKG,
                'executeBatch',
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
     *
     * Inside `fn`, ONLY use the provided `tx.execute` — awaiting
     * `db.execute(...)` (or a nested `db.transaction`) from within the
     * callback deadlocks, because that call queues behind the very
     * transaction that is awaiting it. (The queue can't tell a call made
     * inside the callback from a legitimate concurrent caller on another
     * screen, so this can't fail fast — it's a contract.)
     */
    async transaction<T>(fn: (tx: SQLiteTransaction) => Promise<T>): Promise<T> {
        this.#assertOpen('transaction');
        return this.#enqueue(async () => {
            unwrapNativeVoid(
                PKG,
                'beginTransaction',
                await callAsync(MODULE, 'beginTransaction', this.#handle),
            );
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
                unwrapNativeVoid(PKG, 'commit', await callAsync(MODULE, 'commit', this.#handle));
                if (wildcard) this.#notify('*');
                else if (touched.size > 0) this.#notify(touched);
                return value;
            } catch (e) {
                try {
                    unwrapNativeVoid(PKG, 'rollback', await callAsync(MODULE, 'rollback', this.#handle));
                } catch (rollbackError) {
                    // surface the original error, not the rollback failure —
                    // but a failed rollback leaves the connection inside a
                    // transaction, so it can't be swallowed silently either.
                    log.error('rollback failed after a transaction error', rollbackError);
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
                log.error('onChange listener threw', e);
            }
        }
    }

    /** Close the handle. Subsequent calls on this instance reject. */
    async close(): Promise<void> {
        this.#assertOpen('close');
        this.#closed = true; // calls made from here on fail fast
        registry.delete(this.name);
        return this.#enqueue(async () => {
            unwrapNativeVoid(PKG, 'close', await callAsync(MODULE, 'close', this.#handle));
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
    validateName('openDatabase', name);
    const existing = registry.get(name);
    if (existing) return existing;
    const pending = opening.get(name);
    if (pending) return pending;
    const open = (async () => {
        try {
            const result = unwrapNative<{ handle?: number }>(
                PKG,
                'openDatabase',
                await callAsync(MODULE, 'open', name, options),
            );
            if (typeof result.handle !== 'number') {
                fail('malformed_result', 'openDatabase', 'native open returned no handle', {
                    cause: result,
                });
            }
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
    validateName('deleteDatabase', name);
    if (registry.has(name) || opening.has(name)) {
        fail('database_open', 'deleteDatabase', `database "${name}" is open — close() it before deleting`);
    }
    unwrapNativeVoid(PKG, 'deleteDatabase', await callAsync(MODULE, 'deleteDatabase', name));
}

/** Whether the native Sqlite module is registered in this runtime. */
export function isAvailable(): boolean {
    return isModuleAvailable(MODULE);
}
