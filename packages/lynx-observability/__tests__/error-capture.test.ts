/**
 * Error-capture tests against the REAL core logger (no mock) via a capturing
 * transport: normalization (toError) and the funnel from lynx.onError into an
 * `error`-level `uncaught` record carrying the Error in `fields`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addTransport, clearTransports, setLogLevel, type LogRecord } from '@sigx/lynx-core';
import { installErrorCapture, toError } from '../src/error-capture.js';

const G = globalThis as Record<string, unknown>;
let records: LogRecord[];
let uninstall: (() => void) | undefined;

beforeEach(() => {
    delete G['__sigxObservabilityErrorCaptureInstalled'];
    clearTransports();
    records = [];
    addTransport((r) => records.push(r));
    setLogLevel('trace');
});

afterEach(() => {
    uninstall?.();
    uninstall = undefined;
    delete G['__sigxObservabilityErrorCaptureInstalled'];
    delete G['lynx'];
    setLogLevel('warn');
});

describe('toError', () => {
    it('passes an Error through unchanged', () => {
        const e = new Error('x');
        expect(toError(e)).toBe(e);
    });
    it('unwraps .error / .reason holding an Error', () => {
        const e = new Error('inner');
        expect(toError({ error: e })).toBe(e);
        expect(toError({ reason: e })).toBe(e);
    });
    it('builds from message + stack', () => {
        const r = toError({ message: 'boom', stack: 'at foo' });
        expect(r.message).toBe('boom');
        expect(r.stack).toBe('at foo');
    });
    it('handles plain strings', () => {
        expect(toError('nope').message).toBe('nope');
    });
});

describe('installErrorCapture', () => {
    it('funnels lynx.onError into an error-level `uncaught` record with the Error in fields', () => {
        let lynxCb: ((e: unknown) => void) | undefined;
        G['lynx'] = { onError: (cb: (e: unknown) => void) => { lynxCb = cb; } };
        uninstall = installErrorCapture();
        expect(lynxCb).toBeTypeOf('function');

        lynxCb!(new Error('kaboom'));
        expect(records).toHaveLength(1);
        expect(records[0].namespace).toBe('uncaught');
        expect(records[0].level.name).toBe('error');
        expect(records[0].msg).toContain('kaboom');
        expect(records[0].fields[0]).toBeInstanceOf(Error);
    });

    it('invokes the user onError hook with the normalized Error', () => {
        let lynxCb: ((e: unknown) => void) | undefined;
        G['lynx'] = { onError: (cb: (e: unknown) => void) => { lynxCb = cb; } };
        const seen: Error[] = [];
        uninstall = installErrorCapture({ onError: (e) => seen.push(e) });

        lynxCb!('plain string error');
        expect(seen).toHaveLength(1);
        expect(seen[0].message).toBe('plain string error');
    });

    it('is idempotent (second install is a no-op)', () => {
        let calls = 0;
        G['lynx'] = { onError: () => { calls++; } };
        uninstall = installErrorCapture();
        installErrorCapture(); // no-op — must not register a second lynx.onError
        expect(calls).toBe(1);
        expect(G['__sigxObservabilityErrorCaptureInstalled']).toBe(true);
    });
});
