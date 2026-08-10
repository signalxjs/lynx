import { PKG, fail } from './errors.js';
import type { Migration, SQLiteTransaction } from './types.js';
import type { SQLiteDatabase } from './sqlite.js';

/**
 * Apply pending migrations, tracked via `PRAGMA user_version`.
 *
 * Each migration runs in its own transaction together with the
 * `user_version` bump (the version lives in the database header, so it
 * rolls back with the data) — a crash mid-migration leaves the database at
 * the previous version and the migration re-runs on next launch.
 */
export async function runMigrations(
    db: SQLiteDatabase,
    migrations: readonly Migration[],
): Promise<void> {
    let previous = 0;
    for (const m of migrations) {
        if (!Number.isInteger(m.version) || m.version <= previous) {
            fail(
                'invalid_migration',
                'migrate',
                `migration versions must be strictly increasing positive ` +
                `integers — got ${m.version} after ${previous}`,
            );
        }
        previous = m.version;
    }

    const versionResult = await db.execute<{ user_version: number }>('PRAGMA user_version');
    let current = versionResult.rows[0]?.user_version ?? 0;

    for (const m of migrations) {
        if (m.version <= current) continue;
        try {
            await db.transaction(async (tx) => {
                if (Array.isArray(m.up)) {
                    for (const sql of m.up) await tx.execute(sql);
                } else {
                    await (m.up as (tx: SQLiteTransaction) => Promise<void>)(tx);
                }
                // m.version is a validated integer — safe to inline (PRAGMA
                // doesn't support `?` binding).
                await tx.execute(`PRAGMA user_version = ${m.version}`);
            });
        } catch (e) {
            const reason = e instanceof Error ? e.message : String(e);
            const prefix = `[@sigx/${PKG}] `;
            // A failure from `tx.execute` is already prefixed — one prefix per
            // message. The original error rides along as `cause`, because the
            // message alone drops its `code`, which is what callers branch on.
            fail(
                'migration_failed',
                `migrate to version ${m.version}`,
                reason.startsWith(prefix) ? reason.slice(prefix.length) : reason,
                { cause: e },
            );
        }
        current = m.version;
    }
}
