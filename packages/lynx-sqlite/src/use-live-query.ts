import { computed, onUnmounted, signal, type Computed } from '@sigx/lynx';
import { readTables } from './table-names.js';
import type { SQLiteDatabase } from './sqlite.js';
import type { SQLValue, SQLiteRow } from './types.js';

export interface LiveQueryState<R = SQLiteRow> {
    rows: R[];
    /** True until the first result (or first error) lands. */
    loading: boolean;
    /** Last failure; the previous rows are kept so the UI doesn't blank. */
    error: Error | null;
}

export interface LiveQueryOptions {
    /**
     * Tables whose writes re-run this query. Defaults to the tables
     * extracted from the SQL's FROM/JOIN clauses — pass this explicitly
     * when the query reads through views or anything extraction can't see.
     */
    tables?: readonly string[] | '*';
}

/**
 * BG-reactive query — re-runs whenever one of its tables is written
 * through this database's API, so a chat list updates the moment any
 * screen inserts a message. The `useKeyboard()` idiom: returns a
 * `Computed`, subscriptions are cleaned up on unmount.
 *
 * Accepts the `openDatabase(...)` promise directly so screens don't need
 * their own await-then-render plumbing.
 *
 * ```tsx
 * const messages = useLiveQuery(db,
 *   'SELECT * FROM messages WHERE conversation = ? ORDER BY sent_at DESC LIMIT 50',
 *   [conversationId]);
 * return () => <list>{messages.value.rows.map(renderMessage)}</list>;
 * ```
 */
export function useLiveQuery<R = SQLiteRow>(
    db: SQLiteDatabase | Promise<SQLiteDatabase>,
    sql: string,
    params: readonly SQLValue[] = [],
    options?: LiveQueryOptions,
): Computed<LiveQueryState<R>> {
    // Object signals are deep proxies replaced via $set (no .value) — the
    // computed below reads every field so it re-evaluates on each $set.
    const state = signal<LiveQueryState<R>>({ rows: [], loading: true, error: null });

    let unmounted = false;
    let unsubscribe: (() => void) | null = null;
    // Stale-result guard: results only land if no newer run started since.
    let generation = 0;

    const attach = (database: SQLiteDatabase) => {
        if (unmounted) return;
        const run = () => {
            const g = ++generation;
            database.execute<R>(sql, params).then(
                (result) => {
                    if (g !== generation || unmounted) return;
                    state.$set({ rows: result.rows, loading: false, error: null });
                },
                (e) => {
                    if (g !== generation || unmounted) return;
                    state.$set({
                        rows: [...state.rows] as R[],
                        loading: false,
                        error: e instanceof Error ? e : new Error(String(e)),
                    });
                },
            );
        };
        unsubscribe = database.onChange(options?.tables ?? readTables(sql), run);
        run();
    };

    Promise.resolve(db).then(attach, (e) => {
        if (unmounted) return;
        state.$set({
            rows: [],
            loading: false,
            error: e instanceof Error ? e : new Error(String(e)),
        });
    });

    onUnmounted(() => {
        unmounted = true;
        unsubscribe?.();
    });

    // Detached snapshot (the useUpdates() idiom) — consumers get plain data,
    // and reading every field makes the computed track all of them.
    return computed(() => ({
        rows: [...state.rows] as R[],
        loading: state.loading,
        error: state.error,
    }));
}
