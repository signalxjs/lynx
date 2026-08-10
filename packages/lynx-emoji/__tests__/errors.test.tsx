/**
 * C10 — the errors and diagnostics this package raises.
 *
 * Two contracts: the one thing that can throw carries the scoped prefix and a
 * machine-readable `code`, and every best-effort persistence swallow is
 * *visible* through the namespaced logger instead of vanishing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { component } from '@sigx/lynx';
import { isSigxError, type LogRecord } from '@sigx/lynx-core';
import { render } from '@sigx/lynx-testing';
import { EmojiPicker } from '../src/components/EmojiPicker';

describe('<EmojiPicker> without a dataset', () => {
    it('throws a SigxError with the scoped prefix and a code', () => {
        const Host = component(() => () => <EmojiPicker />);
        let thrown: unknown;
        try {
            render(<Host />);
        } catch (e) {
            thrown = e;
        }
        expect(isSigxError(thrown)).toBe(true);
        const err = thrown as import('@sigx/lynx-core').SigxError;
        expect(err.code).toBe('missing_dataset');
        expect(err.package).toBe('lynx-emoji');
        expect(err.message).toMatch(/^\[@sigx\/lynx-emoji\] EmojiPicker mount failed: /);
    });
});

describe('persistence diagnostics', () => {
    /**
     * `persistence` caches the storage promise at module scope, so each case
     * needs a fresh module graph — and the transport has to be registered on
     * the logger instance *inside* that graph, not the one this file imported.
     */
    async function loadPersistence(): Promise<{
        records: LogRecord[];
        mod: typeof import('../src/state/persistence');
    }> {
        vi.resetModules();
        const core = await import('@sigx/lynx-core');
        const records: LogRecord[] = [];
        core.clearTransports();
        core.addTransport((r) => { records.push(r); });
        return { records, mod: await import('../src/state/persistence') };
    }

    afterEach(() => {
        vi.doUnmock('@sigx/lynx-storage');
        vi.resetModules();
    });

    it('logs instead of swallowing when the storage peer fails', async () => {
        vi.doMock('@sigx/lynx-storage', () => ({
            Storage: {
                isAvailable: () => true,
                getItem: () => Promise.reject(new Error('read boom')),
                setItem: () => { throw new Error('write boom'); },
            },
        }));
        const { records, mod: { loadString, saveString } } = await loadPersistence();

        await expect(loadString('k')).resolves.toBeNull();
        saveString('k', 'v');
        // saveString is fire-and-forget — let its storage promise settle.
        await new Promise((r) => setTimeout(r, 0));

        const warnings = records.filter((r) => r.level.name === 'warn');
        expect(warnings.map((r) => r.namespace)).toEqual(['lynx-emoji', 'lynx-emoji']);
        expect(warnings[0].msg).toBe('reading k failed');
        expect(warnings[1].msg).toBe('writing k failed');
    });

    it('logs at debug — not warn — when the optional peer is absent', async () => {
        vi.doMock('@sigx/lynx-storage', () => {
            throw new Error('Cannot find module');
        });
        const { records, mod: { loadString } } = await loadPersistence();

        await expect(loadString('k')).resolves.toBeNull();
        expect(records.filter((r) => r.level.name === 'warn')).toHaveLength(0);
        expect(records.some((r) => r.level.name === 'debug')).toBe(true);
    });
});
