/**
 * Trigger sessions — the state machine behind the suggestion popup.
 *
 * The element exposes no keystrokes, so the session is a pure function of the
 * editor's two event streams: document text (`bindchange`) and the collapsed
 * caret offset (`bindselection`). On every sync we look at the **run** — the
 * non-whitespace text between the last boundary and the caret. A run starting
 * with a trigger (`@` / a pattern match) means an active session whose query
 * is the rest of the run; anything else means no session. Whitespace, caret
 * exits, blur and selection all close it for free, because they all change
 * the run.
 *
 * `onQuery` may be async: results are tagged with an epoch and discarded when
 * a newer query (or a close) supersedes them. An optional per-trigger
 * `debounce` batches fast typing.
 */

import type { TriggerItem, TriggerSpec } from '../plugin.js';

export interface TriggerSession {
    /** Owning plugin's name. */
    plugin: string;
    /** Offset of the trigger char (run start) in the document text. */
    anchor: number;
    /** Text typed after the trigger prefix. */
    query: string;
    /** Caret offset (exclusive end of the run). */
    caret: number;
    /** Latest resolved suggestions ([] while loading or empty). */
    items: TriggerItem[];
    /** True while an async `onQuery` for the current query is in flight. */
    loading: boolean;
}

export interface TriggerSessionManager {
    /** Feed the latest document text (from `bindchange`). */
    syncText(text: string): void;
    /** Feed the collapsed caret offset (from `bindselection`); `-1` = no collapsed caret. */
    syncCaret(caret: number): void;
    /** Close the active session (blur, selection made, escape). */
    close(): void;
    readonly session: TriggerSession | null;
}

export interface TriggerSessionManagerOptions {
    triggers: ReadonlyArray<{ plugin: string; spec: TriggerSpec }>;
    /** Fired whenever the session opens, updates (query/items), or closes. */
    onUpdate(session: TriggerSession | null): void;
}

/** Trigger-prefix length when `run` starts with this trigger, else `-1`. */
function matchTrigger(spec: TriggerSpec, run: string): number {
    if (spec.char !== undefined) {
        return run.startsWith(spec.char) ? spec.char.length : -1;
    }
    if (spec.pattern) {
        // Reset stateful lastIndex (g/y flags) so matching is deterministic.
        spec.pattern.lastIndex = 0;
        const m = spec.pattern.exec(run);
        return m && m.index === 0 ? m[0].length : -1;
    }
    return -1;
}

export function createTriggerSessionManager(opts: TriggerSessionManagerOptions): TriggerSessionManager {
    let text = '';
    let caret = -1;
    let session: TriggerSession | null = null;
    /** Bumped on every query change/close; stale async results check it. */
    let epoch = 0;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const clearTimer = (): void => {
        if (debounceTimer !== null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
    };

    const emit = (): void => {
        opts.onUpdate(session ? { ...session } : null);
    };

    const close = (): void => {
        if (!session) return;
        epoch++;
        clearTimer();
        session = null;
        emit();
    };

    const runQuery = (spec: TriggerSpec): void => {
        if (!session) return;
        const myEpoch = ++epoch;
        const query = session.query;
        const exec = (): void => {
            debounceTimer = null;
            if (epoch !== myEpoch || !session) return;
            let result: ReturnType<typeof spec.onQuery>;
            try {
                result = spec.onQuery(query);
            } catch {
                // A throwing onQuery behaves like a rejected async query.
                session.items = [];
                session.loading = false;
                emit();
                return;
            }
            if (Array.isArray(result)) {
                session.items = result;
                session.loading = false;
                emit();
                return;
            }
            result.then(
                (items) => {
                    // Discard stale resolutions: a newer query or a close won.
                    if (epoch !== myEpoch || !session) return;
                    session.items = items;
                    session.loading = false;
                    emit();
                },
                () => {
                    if (epoch !== myEpoch || !session) return;
                    session.items = [];
                    session.loading = false;
                    emit();
                },
            );
        };
        clearTimer();
        if (spec.debounce && spec.debounce > 0) {
            debounceTimer = setTimeout(exec, spec.debounce);
        } else {
            exec();
        }
    };

    const evaluate = (): void => {
        if (caret < 0 || caret > text.length) {
            close();
            return;
        }
        // The run: non-whitespace text between the last boundary and the caret.
        let start = caret;
        while (start > 0 && !/\s/.test(text[start - 1])) start--;
        const run = text.slice(start, caret);

        for (const { plugin, spec } of opts.triggers) {
            const prefixLen = matchTrigger(spec, run);
            if (prefixLen < 0) continue;
            const query = run.slice(prefixLen);
            if (session && session.plugin === plugin && session.anchor === start) {
                session.caret = caret;
                if (session.query !== query) {
                    session.query = query;
                    // Clear stale results: the popup must never offer the
                    // previous query's suggestions while the new one resolves.
                    session.items = [];
                    session.loading = true;
                    emit();
                    runQuery(spec);
                }
                return;
            }
            session = { plugin, anchor: start, query, caret, items: [], loading: true };
            emit();
            runQuery(spec);
            return;
        }
        close();
    };

    return {
        syncText: (t) => {
            text = t ?? '';
            evaluate();
        },
        syncCaret: (c) => {
            caret = c;
            evaluate();
        },
        close,
        get session() {
            return session;
        },
    };
}
