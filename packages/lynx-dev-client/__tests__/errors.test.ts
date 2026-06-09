/**
 * Dev uncaught-error logging: formatting + that the hooks route to console.error
 * (which the streamer forwards to the `sigx dev` terminal).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatError, installDevErrorLogging } from '../src/errors.js';

const G = globalThis as Record<string, unknown>;

describe('formatError', () => {
    it('uses an Error stack', () => {
        const e = new Error('boom');
        expect(formatError(e)).toBe(e.stack || 'Error: boom');
    });
    it('unwraps ErrorEvent.error / rejection.reason', () => {
        const inner = new Error('inner');
        expect(formatError({ error: inner })).toBe(inner.stack || 'Error: inner');
        expect(formatError({ reason: inner })).toBe(inner.stack || 'Error: inner');
    });
    it('builds message + stack from a plain object', () => {
        expect(formatError({ message: 'oops', stack: 'at x' })).toBe('oops\nat x');
    });
    it('handles strings and odd values', () => {
        expect(formatError('plain')).toBe('plain');
        expect(formatError(42)).toBe('42');
    });
});

describe('installDevErrorLogging', () => {
    let captured: ((e: unknown) => void) | undefined;
    let errorSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        delete G['__sigxDevErrorLoggingInstalled'];
        captured = undefined;
        G['lynx'] = { onError: (cb: (e: unknown) => void) => { captured = cb; } };
        errorSpy = vi.fn();
        G['console'] = { error: errorSpy };
    });
    afterEach(() => {
        delete G['lynx'];
        delete G['__sigxDevErrorLoggingInstalled'];
    });

    it('routes a lynx.onError error to console.error with message + source tag', () => {
        installDevErrorLogging();
        expect(captured).toBeTypeOf('function');
        captured!(new Error('kaboom'));
        expect(errorSpy).toHaveBeenCalledTimes(1);
        const msg = String(errorSpy.mock.calls[0][0]);
        expect(msg).toContain('[lynx:onError]');
        expect(msg).toContain('kaboom');
    });

    it('is idempotent — a second install does not double-register', () => {
        installDevErrorLogging();
        const first = captured;
        installDevErrorLogging(); // no-op (guard set)
        expect(captured).toBe(first);
    });
});
