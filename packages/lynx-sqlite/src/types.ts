/**
 * A value bindable to a `?` placeholder. Booleans bind as 1/0 (SQLite has
 * no boolean type); `undefined` params are treated as NULL. BLOBs are not
 * supported in v1 — store a file path (see `@sigx/lynx-file-system`) or
 * base64 TEXT instead.
 */
export type SQLValue = string | number | boolean | null | undefined;

/**
 * A result row. SQLite INTEGER/REAL columns come back as JS numbers —
 * integers above 2^53 lose precision crossing the bridge, so store
 * snowflake-style ids as TEXT.
 */
export type SQLiteRow = Record<string, string | number | null>;

/** One statement for `executeBatch`: `[sql]` or `[sql, params]`. */
export type SQLStatement = readonly [sql: string, params?: readonly SQLValue[]];

export interface QueryResult<R = SQLiteRow> {
    rows: R[];
    /** Rows changed by INSERT/UPDATE/DELETE; 0 for read-only statements. */
    rowsAffected: number;
    /** `last_insert_rowid()` after an INSERT/REPLACE; null otherwise. */
    insertId: number | null;
}

/**
 * Options for `openDatabase`. Reserved for v2 (readOnly, encryption key,
 * custom location) — empty in v1 so adding fields is non-breaking.
 */
export interface OpenOptions {}

/** The statement runner handed to `transaction()` / function migrations. */
export interface SQLiteTransaction {
    execute<R = SQLiteRow>(sql: string, params?: readonly SQLValue[]): Promise<QueryResult<R>>;
}

export interface Migration {
    /** Strictly increasing positive integer, stored in `PRAGMA user_version`. */
    version: number;
    /**
     * Statements run atomically (one transaction per migration), or a
     * function for data migrations. A crash mid-migration rolls back and
     * the migration re-runs on next launch.
     */
    up: readonly string[] | ((tx: SQLiteTransaction) => Promise<void>);
}
