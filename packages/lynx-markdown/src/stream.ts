/**
 * `createMarkdownStream()` — a one-line bridge between an AI token loop and
 * `<Markdown>`.
 *
 * It owns a reactive `value` signal and coalesces bursts of `append()` calls
 * into a single signal write per `flushIntervalMs` window, so a fast token
 * stream re-renders at a bounded rate instead of once per token.
 *
 * @example
 * ```tsx
 * const md = createMarkdownStream({ flushIntervalMs: 16 });
 *
 * // producer
 * for await (const token of completion) md.append(token);
 * md.done();
 *
 * // consumer
 * <Markdown value={md.value.value} />
 * ```
 */

import { signal, type PrimitiveSignal } from '@sigx/lynx';

export interface CreateMarkdownStreamOptions {
    /**
     * Coalesce `append()` calls within this many milliseconds into a single
     * `value` update. `0` (default) flushes synchronously on every append.
     * A small value such as `16` caps re-renders to ~60fps under fast streams.
     */
    flushIntervalMs?: number;
}

export interface MarkdownStream {
    /** Reactive accumulated source. Pass to `<Markdown value={stream.value.value} />`. */
    readonly value: PrimitiveSignal<string>;
    /** Reactive completion flag, set by {@link MarkdownStream.done}. */
    readonly finished: PrimitiveSignal<boolean>;
    /** Append a token/chunk; buffered and coalesced into `value`. */
    append(chunk: string): void;
    /** Flush any pending buffer and mark the stream complete. */
    done(): void;
    /** Clear the buffer, `value`, and `finished` (e.g. for a regenerate). */
    reset(): void;
}

export function createMarkdownStream(opts?: CreateMarkdownStreamOptions): MarkdownStream {
    const flushIntervalMs = opts?.flushIntervalMs ?? 0;
    const value = signal('');
    const finished = signal(false);

    let buffer = '';
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = (): void => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (value.value !== buffer) value.value = buffer;
    };

    const schedule = (): void => {
        if (flushIntervalMs <= 0) {
            flush();
            return;
        }
        if (timer === null) timer = setTimeout(flush, flushIntervalMs);
    };

    return {
        value,
        finished,
        append(chunk: string): void {
            if (!chunk) return;
            buffer += chunk;
            if (finished.value) finished.value = false;
            schedule();
        },
        done(): void {
            flush();
            finished.value = true;
        },
        reset(): void {
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            buffer = '';
            value.value = '';
            finished.value = false;
        },
    };
}
