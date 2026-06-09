/**
 * Tests for the leveled + namespaced logger. The logger keeps module-global
 * state (threshold, disabled namespaces, transports), so each test resets it
 * via the public API in `beforeEach` and installs a capturing transport.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createLogger,
    setLogLevel,
    getLogLevel,
    enableNamespace,
    disableNamespace,
    addTransport,
    clearTransports,
    consoleTransport,
    type LogRecord,
} from '../src/index.js';

let captured: LogRecord[];

beforeEach(() => {
    clearTransports();
    captured = [];
    addTransport((r) => captured.push(r));
    setLogLevel('trace'); // emit everything unless a test narrows it
});

describe('logger — levels & threshold', () => {
    it('emits at or above the threshold, drops below', () => {
        setLogLevel('warn');
        const log = createLogger('t');
        log.trace('a'); log.debug('b'); log.info('c'); log.warn('d'); log.error('e');
        expect(captured.map((r) => r.level.name)).toEqual(['warn', 'error']);
    });

    it('silent suppresses everything', () => {
        setLogLevel('silent');
        const log = createLogger('t');
        log.error('boom');
        expect(captured).toHaveLength(0);
    });

    it('enabled() reflects threshold and namespace', () => {
        setLogLevel('info');
        const log = createLogger('t');
        expect(log.enabled('debug')).toBe(false);
        expect(log.enabled('info')).toBe(true);
        expect(log.enabled('error')).toBe(true);
        disableNamespace('t');
        expect(log.enabled('error')).toBe(false);
    });
});

describe('logger — namespaces', () => {
    it('disable silences a namespace; enable restores it', () => {
        const a = createLogger('a');
        const b = createLogger('b');
        disableNamespace('a');
        a.info('hidden');
        b.info('shown');
        expect(captured.map((r) => r.namespace)).toEqual(['b']);

        enableNamespace('a');
        a.info('now shown');
        expect(captured.map((r) => r.namespace)).toEqual(['b', 'a']);
    });
});

describe('logger — record shape & transports', () => {
    it('hands each transport a structured record', () => {
        const log = createLogger('http');
        const before = Date.now();
        log.info('hello', { id: 1 }, 'extra');
        expect(captured).toHaveLength(1);
        const r = captured[0];
        expect(r.namespace).toBe('http');
        expect(r.level).toEqual({ name: 'info', severity: 30 });
        expect(r.msg).toBe('hello');
        expect(r.fields).toEqual([{ id: 1 }, 'extra']);
        expect(r.ts).toBeGreaterThanOrEqual(before);
    });

    it('dispatches to every registered transport', () => {
        const second: LogRecord[] = [];
        addTransport((r) => second.push(r));
        createLogger('x').warn('two');
        expect(captured).toHaveLength(1);
        expect(second).toHaveLength(1);
    });

    it('a throwing transport never breaks the caller or other transports', () => {
        addTransport(() => { throw new Error('bad sink'); });
        const after: LogRecord[] = [];
        addTransport((r) => after.push(r));
        expect(() => createLogger('x').error('still fine')).not.toThrow();
        expect(after).toHaveLength(1);
    });
});

describe('consoleTransport — level routing', () => {
    afterEach(() => vi.restoreAllMocks());

    it('routes error→console.error, warn→console.warn, rest→console.log', () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        const rec = (name: LogRecord['level']['name']): LogRecord =>
            ({ level: { name, severity: 0 }, namespace: 'n', msg: 'm', fields: [], ts: 0 });
        consoleTransport(rec('error'));
        consoleTransport(rec('warn'));
        consoleTransport(rec('debug'));
        consoleTransport(rec('info'));
        expect(err).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledTimes(2);
        expect(err).toHaveBeenCalledWith('[n]', 'm');
    });
});

describe('logger — default level', () => {
    it('defaults to debug when no __SIGX_LOG_LEVEL__ is injected (this test env)', async () => {
        vi.resetModules();
        const fresh = await import('../src/logger.js');
        expect(fresh.getLogLevel()).toBe('debug');
    });

    it('built dist references neither `process` nor `__DEV__` (Lynx BG has no process global)', () => {
        // The first __DEV__-based default crashed the BG bundle with
        // "ReferenceError: process is not defined" (the __DEV__ define expands
        // to a process.env expression). Assert the SHIPPED artifact is clean.
        const dist = readFileSync(new URL('../dist/logger.js', import.meta.url), 'utf-8');
        expect(dist).not.toContain('process');
        expect(dist).not.toContain('__DEV__');
    });
});
