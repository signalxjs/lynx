/**
 * The package's one error shape (C10).
 *
 * Internal — not re-exported from the barrel. It lives in its own file
 * because `migrations.ts` throws too and `sqlite.ts` already imports
 * `runMigrations`, so a helper on either side would close a cycle.
 */
import { SigxError } from '@sigx/lynx-core';

export const PKG = 'lynx-sqlite';

/**
 * Stable discriminants for the failures a caller can act on. Native-side
 * failures carry core's `'native_error'` instead — see `unwrapNative`.
 */
export type SqliteErrorCode =
    | 'database_closed'
    | 'database_open'
    | 'invalid_database_name'
    | 'invalid_migration'
    | 'invalid_param'
    | 'invalid_sql'
    | 'malformed_result'
    | 'migration_failed';

/** Throw `[@sigx/lynx-sqlite] <action> failed: <detail>` with a branchable `code`. */
export function fail(
    code: SqliteErrorCode,
    action: string,
    detail: string,
    options?: { cause?: unknown },
): never {
    throw new SigxError(PKG, code, `[@sigx/${PKG}] ${action} failed: ${detail}`, options);
}
