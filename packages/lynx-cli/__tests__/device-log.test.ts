/**
 * Tests for the CLI's device-log sentinel parser + formatter.
 */

import { describe, it, expect } from 'vitest';
import {
    parseDeviceLogLine,
    formatDeviceLogLine,
    LOG_SENTINEL,
    type DeviceLogEntry,
} from '../src/device-log';

function stripAnsi(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('parseDeviceLogLine', () => {
    it('returns null for non-sentinel lines', () => {
        expect(parseDeviceLogLine('hello world')).toBeNull();
        expect(parseDeviceLogLine('')).toBeNull();
        expect(parseDeviceLogLine('SIGX_LOG missing-nul')).toBeNull();
    });

    it('parses a valid sentinel line', () => {
        const entry: DeviceLogEntry = {
            level: 'warn',
            args: ['oops', 'foo'],
            ts: 1700000000000,
            platform: 'ios',
            client: 2,
        };
        const out = parseDeviceLogLine(`${LOG_SENTINEL}${JSON.stringify(entry)}`);
        expect(out).toEqual(entry);
    });

    it('returns null for invalid JSON after sentinel', () => {
        expect(parseDeviceLogLine(`${LOG_SENTINEL}{not json`)).toBeNull();
    });

    it('returns null when required fields are missing', () => {
        expect(parseDeviceLogLine(`${LOG_SENTINEL}{}`)).toBeNull();
        expect(parseDeviceLogLine(`${LOG_SENTINEL}${JSON.stringify({ level: 'log' })}`)).toBeNull();
    });

    it('defaults missing optional fields', () => {
        const out = parseDeviceLogLine(`${LOG_SENTINEL}${JSON.stringify({
            level: 'log',
            args: ['x'],
        })}`);
        expect(out?.platform).toBe('unknown');
        expect(out?.client).toBe(0);
        expect(typeof out?.ts).toBe('number');
    });
});

describe('formatDeviceLogLine', () => {
    it('includes platform, client id, level label, and message', () => {
        const out = formatDeviceLogLine({
            level: 'log',
            args: ['hello', 'world'],
            ts: new Date('2024-01-01T13:14:15Z').getTime(),
            platform: 'ios',
            client: 3,
        });
        const plain = stripAnsi(out);
        expect(plain).toContain('📱 ios #3');
        expect(plain).toContain('LOG');
        expect(plain).toContain('hello world');
    });

    it('uses ERR label for error level', () => {
        const out = formatDeviceLogLine({
            level: 'error',
            args: ['boom'],
            ts: 0,
            platform: 'android',
            client: 1,
        });
        expect(stripAnsi(out)).toContain('ERR');
    });

    it('indents multi-line messages', () => {
        const out = formatDeviceLogLine({
            level: 'log',
            args: ['line1\nline2'],
            ts: 0,
            platform: 'ios',
            client: 1,
        });
        const plain = stripAnsi(out);
        expect(plain).toContain('line1');
        expect(plain).toContain('\n           line2');
    });
});
