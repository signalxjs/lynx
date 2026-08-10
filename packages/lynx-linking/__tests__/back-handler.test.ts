/** BackHandler — subscriber isolation and where its diagnostics go. */
import { addTransport, clearTransports, type LogRecord } from '@sigx/lynx-core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BackHandler } from '../src/back-handler';

let listeners: Map<string, () => void>;
let records: LogRecord[];

beforeEach(() => {
    listeners = new Map();
    records = [];
    // Replace the default console transport so the assertion is about the
    // logger pipeline, not about what console.warn happened to receive.
    clearTransports();
    addTransport((r) => records.push(r));
    vi.stubGlobal('lynx', {
        getJSModule: () => ({
            addListener: (n: string, fn: () => void) => listeners.set(n, fn),
            removeListener: (n: string) => listeners.delete(n),
        }),
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
    clearTransports();
});

describe('BackHandler.addEventListener', () => {
    it('reports a throwing listener through the core logger, not console (C10)', () => {
        const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sub = BackHandler.addEventListener(() => {
            throw new Error('boom');
        });

        expect(() => listeners.get('hardwareBackPress')!()).not.toThrow();
        expect(records).toHaveLength(1);
        expect(records[0]!.namespace).toBe('lynx-linking');
        expect(records[0]!.level.name).toBe('warn');
        expect(records[0]!.msg).toBe('back-press listener threw');
        expect(records[0]!.fields[0]).toBeInstanceOf(Error);
        expect(consoleWarn).not.toHaveBeenCalled();

        consoleWarn.mockRestore();
        sub.remove();
        expect(listeners.size).toBe(0);
    });

    it('stays quiet when the listener returns normally', () => {
        const handled = vi.fn(() => true);
        BackHandler.addEventListener(handled);
        listeners.get('hardwareBackPress')!();
        expect(handled).toHaveBeenCalledTimes(1);
        expect(records).toHaveLength(0);
    });
});
