/**
 * Dev-only uncaught-error visibility.
 *
 * Without this, an uncaught JS error in a dev build only surfaces as the
 * native red overlay (`com.lynx.error error 0`) with no message/stack, and
 * nothing reaches the `sigx dev` terminal — production error capture lives in
 * the opt-in `@sigx/lynx-observability`, which most apps don't wire in dev.
 *
 * Since the dev-client already patches/streams `console.*`, we hook the
 * background-thread `lynx.onError` plus `globalThis` `error`/`unhandledrejection`
 * and `console.error` whatever they carry — so the real message + stack show up
 * in the terminal. Dev-only (this module is prepended only in dev builds).
 */

// `lynx` is the background-thread global; `onError` is its uncaught-error hook.
declare const lynx: unknown | undefined;
interface LynxLike {
    onError?: (callback: (error: unknown) => void) => void;
}
function lynxObj(): LynxLike | undefined {
    return typeof lynx !== 'undefined' ? (lynx as LynxLike) : undefined;
}

/** Best-effort message+stack from anything thrown (Error, ErrorEvent, rejection, string, object). */
export function formatError(input: unknown): string {
    if (input instanceof Error) return input.stack || `${input.name}: ${input.message}`;
    if (input && typeof input === 'object') {
        const o = input as Record<string, unknown>;
        const inner = o['error'] ?? o['reason'];
        if (inner instanceof Error) return inner.stack || `${inner.name}: ${inner.message}`;
        const msg = o['message'] ?? o['reason'] ?? o['error'];
        const stack = typeof o['stack'] === 'string' ? `\n${o['stack']}` : '';
        let head: string;
        try {
            head = typeof msg === 'string' && msg ? msg : (JSON.stringify(input) ?? String(input));
        } catch {
            head = String(input);
        }
        return `${head}${stack}`;
    }
    return typeof input === 'string' ? input : String(input);
}

const G = globalThis as Record<string, unknown>;
const INSTALLED = '__sigxDevErrorLoggingInstalled';

/**
 * Hook uncaught-error sources and `console.error` them (which the streamer
 * forwards to the `sigx dev` terminal). Idempotent across HMR / multiple
 * bundle copies. Never throws.
 */
export function installDevErrorLogging(): void {
    if (G[INSTALLED]) return;
    G[INSTALLED] = true;

    const emit = (input: unknown, source: string): void => {
        try {
            const text = formatError(input);
            // Drop dev-server / HMR artifacts — they fire constantly and aren't
            // app errors (e.g. "Failed to load CSS update file …hot-update.json").
            // Check only the headline (first line) so a stack frame mentioning
            // "hot-update" can't suppress a real error.
            const headline = (text.split('\n', 1)[0] ?? '').toLowerCase();
            if (headline.includes('hot-update') || headline.includes('failed to load css update file')) return;
            (globalThis as { console?: { error?: (...a: unknown[]) => void } }).console?.error?.(
                `[lynx:${source}] ${text}`,
            );
        } catch {
            /* never let error logging throw */
        }
    };

    // 1. Lynx background-thread hook (no documented removal).
    const lx = lynxObj();
    if (typeof lx?.onError === 'function') {
        try {
            lx.onError((e) => emit(e, 'onError'));
        } catch {
            /* ignore */
        }
    }

    // 2. globalThis handlers where present (web/dev and hosts exposing them).
    const g = globalThis as unknown as {
        addEventListener?: (type: string, fn: (e: unknown) => void) => void;
        onerror?: ((...args: unknown[]) => unknown) | null;
        onunhandledrejection?: ((e: unknown) => unknown) | null;
    };
    if (typeof g.addEventListener === 'function') {
        try {
            g.addEventListener('error', (e) => emit(e, 'error'));
        } catch {
            /* ignore */
        }
        try {
            g.addEventListener('unhandledrejection', (e) => emit(e, 'unhandledrejection'));
        } catch {
            /* ignore */
        }
    } else {
        // Hosts without `addEventListener` — fall back to the on* properties,
        // chaining to any handler already installed (don't clobber it).
        const priorErr = typeof g.onerror === 'function' ? g.onerror : undefined;
        g.onerror = (...args: unknown[]) => {
            // (message, source, lineno, colno, error) — prefer the Error object.
            emit(args[4] ?? args[0], 'error');
            return priorErr ? priorErr(...args) : false;
        };
        const priorRej = typeof g.onunhandledrejection === 'function' ? g.onunhandledrejection : undefined;
        g.onunhandledrejection = (e: unknown) => {
            emit(e, 'unhandledrejection');
            return priorRej ? priorRej(e) : undefined;
        };
    }
}
