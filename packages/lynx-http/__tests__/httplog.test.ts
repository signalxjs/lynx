/**
 * Tests the `http`-namespace request logging against the REAL core logger
 * (no mock here) via a capturing transport: format of the start/finish lines,
 * the timing breakdown, and once-per-terminal behavior.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    setLogLevel,
    clearTransports,
    addTransport,
    type LogRecord,
} from '@sigx/lynx-core';
import * as httplog from '../src/httplog.js';

let records: LogRecord[];
const msgs = (): string[] => records.map((r) => `${r.level.name} ${r.msg}`);

beforeEach(() => {
    clearTransports();
    records = [];
    addTransport((r) => records.push(r));
    setLogLevel('debug'); // see the verbose request traces
});

afterEach(() => {
    setLogLevel('warn');
    clearTransports();
});

describe('http request logging', () => {
    it('logs a start line and a finish line with a timing breakdown', () => {
        httplog.start(1, 'GET', 'https://api.test/users');
        httplog.response(1, 200);
        httplog.addBytes(1, 1500);
        httplog.finish(1);

        expect(records[0]).toMatchObject({ namespace: 'http', level: { name: 'debug' } });
        expect(records[0].msg).toBe('→ GET https://api.test/users');

        const finish = records[1];
        expect(finish.level.name).toBe('debug');
        // e.g. "← 200 GET https://api.test/users  (12ms total · TTFB 8ms · body 4ms · 1.5 KB)"
        expect(finish.msg).toMatch(
            /^← 200 GET https:\/\/api\.test\/users {2}\(\d+ms total · TTFB \d+ms · body \d+ms · 1\.5 KB\)$/,
        );
    });

    it('shows ? for an unknown (0) status in the finish line', () => {
        httplog.start(8, 'GET', 'https://api.test/q');
        httplog.response(8, 0); // shim sentinel for "native omitted status"
        httplog.finish(8);
        const finish = records.find((r) => r.msg.startsWith('←'))!;
        expect(finish.msg).toContain('← ? GET');
    });

    it('strips query/fragment from the warn-level failure URL (no credential leak)', () => {
        httplog.start(9, 'GET', 'https://api.test/login?token=secret#frag');
        httplog.fail(9, 'boom');
        const fail = records.find((r) => r.msg.startsWith('✕'))!;
        expect(fail.msg).toContain('https://api.test/login');
        expect(fail.msg).not.toContain('secret');
        expect(fail.msg).not.toContain('frag');
    });

    it('logs failures at warn with method/url context', () => {
        httplog.start(2, 'POST', 'https://api.test/login');
        const fail = (() => { httplog.fail(2, 'connection refused'); return records.find((r) => r.msg.startsWith('✕'))!; })();
        expect(fail.level.name).toBe('warn');
        expect(fail.msg).toMatch(/^✕ POST https:\/\/api\.test\/login {2}\(\d+ms · 0 B\) — connection refused$/);
    });

    it('a terminal event on an unknown/cleared id does not log', () => {
        httplog.fail(999, 'never started');
        httplog.abort(999, 'signal');
        expect(records).toHaveLength(0);
    });

    it('logs aborts at debug with a reason', () => {
        httplog.start(3, 'GET', 'https://api.test/sse');
        httplog.abort(3, 'signal');
        const abort = records.find((r) => r.msg.startsWith('⊘'))!;
        expect(abort.level.name).toBe('debug');
        expect(abort.msg).toMatch(/aborted \(signal\)$/);
    });

    it('each terminal event logs once and clears state (no double log)', () => {
        httplog.start(4, 'GET', 'https://api.test/x');
        httplog.response(4, 200);
        httplog.finish(4);
        httplog.finish(4); // stale — already cleared
        httplog.fail(4, 'late error'); // also stale
        const finishLines = records.filter((r) => r.msg.startsWith('←'));
        const failLines = records.filter((r) => r.msg.startsWith('✕'));
        expect(finishLines).toHaveLength(1);
        expect(failLines).toHaveLength(0);
    });

    it('suppresses verbose traces below debug, but failures still warn', () => {
        setLogLevel('warn');
        httplog.start(5, 'GET', 'https://api.test/y');
        httplog.response(5, 200);
        httplog.finish(5);
        expect(records).toHaveLength(0); // → and ← are debug-gated

        // A different request that fails still surfaces at warn (start recorded
        // timing regardless of level, so the warn has method/url context).
        httplog.start(6, 'GET', 'https://api.test/z');
        httplog.fail(6, 'boom');
        expect(records).toHaveLength(1);
        expect(records[0].level.name).toBe('warn');
        expect(records[0].msg).toContain('GET https://api.test/z');
    });
});
