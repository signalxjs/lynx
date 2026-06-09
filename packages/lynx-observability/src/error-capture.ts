/**
 * Production error capture. Registers Lynx's background-thread error hook
 * (`lynx.onError`) plus the `globalThis` `error` / `unhandledrejection`
 * handlers where present, normalizes whatever was thrown into an `Error`, and
 * funnels it into the core logger as an `error`-level record under the
 * `uncaught` namespace.
 *
 * Because it goes through the core logger, captured errors show up in the
 * `sigx dev` terminal AND reach every registered transport (e.g. a remote
 * sink from {@link createHttpSink}). The original `Error` rides in the record
 * `fields`, so transports can treat it as an exception (with a stack) rather
 * than a plain log line.
 */
import { createLogger } from '@sigx/lynx-core';

const log = createLogger('uncaught');

interface LynxLike {
    onError?: (callback: (error: unknown) => void) => void;
}
declare const lynx: unknown | undefined;
function lynxObj(): LynxLike | undefined {
    return typeof lynx !== 'undefined' ? (lynx as LynxLike) : undefined;
}

export interface ErrorCaptureOptions {
    /** Extra callback invoked with the normalized Error for each captured error. */
    onError?: (error: Error) => void;
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/** Normalize anything thrown (Error, ErrorEvent, PromiseRejection, string, …) into an Error. */
export function toError(input: unknown): Error {
    if (input instanceof Error) return input;
    if (input && typeof input === 'object') {
        const o = input as Record<string, unknown>;
        // ErrorEvent.error / PromiseRejectionEvent.reason may hold the real Error.
        const inner = o['error'] ?? o['reason'];
        if (inner instanceof Error) return inner;
        const msg = o['message'] ?? o['reason'] ?? o['error'];
        const err = new Error(typeof msg === 'string' && msg ? msg : safeStringify(input));
        if (typeof o['stack'] === 'string') err.stack = o['stack'];
        return err;
    }
    return new Error(typeof input === 'string' ? input : safeStringify(input));
}

// Idempotent across module re-evaluation (HMR) / multiple bundle copies.
const G = globalThis as Record<string, unknown>;
const INSTALLED = '__sigxObservabilityErrorCaptureInstalled';

/**
 * Install global error capture. Returns an uninstall function. Idempotent —
 * calling it again while already installed is a no-op and returns a no-op
 * uninstall.
 */
export function installErrorCapture(opts: ErrorCaptureOptions = {}): () => void {
    if (G[INSTALLED]) return () => { /* already installed elsewhere */ };
    G[INSTALLED] = true;

    const report = (input: unknown, source: string): void => {
        const err = toError(input);
        // Error object in fields → transports can treat it as an exception.
        log.error(`[${source}] ${err.message}`, err);
        try {
            opts.onError?.(err);
        } catch {
            /* never let a user hook break capture */
        }
    };

    const undo: Array<() => void> = [];

    // 1. Lynx background-thread hook (no documented removal — nothing to undo).
    const lx = lynxObj();
    if (typeof lx?.onError === 'function') {
        lx.onError((e) => report(e, 'lynx'));
    }

    // 2. globalThis handlers (web/dev and any host exposing them).
    const g = globalThis as unknown as {
        addEventListener?: (t: string, fn: (e: unknown) => void) => void;
        removeEventListener?: (t: string, fn: (e: unknown) => void) => void;
        onerror?: unknown;
        onunhandledrejection?: unknown;
    };
    if (typeof g.addEventListener === 'function') {
        const onErr = (e: unknown): void => report((e as { error?: unknown })?.error ?? e, 'error');
        const onRej = (e: unknown): void => report((e as { reason?: unknown })?.reason ?? e, 'unhandledrejection');
        g.addEventListener('error', onErr);
        g.addEventListener('unhandledrejection', onRej);
        undo.push(() => {
            g.removeEventListener?.('error', onErr);
            g.removeEventListener?.('unhandledrejection', onRej);
        });
    } else {
        const prevErr = g.onerror;
        const prevRej = g.onunhandledrejection;
        g.onerror = (...args: unknown[]): boolean => {
            // (message, source, lineno, colno, error)
            report(args[4] ?? args[0], 'error');
            // Chain to any pre-existing handler so we don't clobber host/app
            // error reporting; preserve its return value (truthy = handled).
            if (typeof prevErr === 'function') {
                return (prevErr as (...a: unknown[]) => boolean)(...args);
            }
            return false;
        };
        g.onunhandledrejection = (e: unknown): void => {
            report((e as { reason?: unknown })?.reason ?? e, 'unhandledrejection');
            if (typeof prevRej === 'function') (prevRej as (ev: unknown) => void)(e);
        };
        undo.push(() => {
            g.onerror = prevErr;
            g.onunhandledrejection = prevRej;
        });
    }

    return () => {
        if (!G[INSTALLED]) return;
        G[INSTALLED] = false;
        for (const u of undo) u();
    };
}
