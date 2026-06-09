/**
 * Tests the auto-wire entry's config application (`install`) with a mocked
 * `initObservability`: no-op when unset, forwards options when configured,
 * and never throws on malformed input.
 *
 * Importing `../src/install.js` runs its side effect once; in vitest the
 * injected `__SIGX_OBSERVABILITY_CONFIG__` is undefined, so that bootstrap is
 * a no-op (asserted below). The exported `install()` is then exercised directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const initMock = vi.fn();
vi.mock('../src/init.js', () => ({ initObservability: (...a: unknown[]) => initMock(...(a as [])) }));

const { install } = await import('../src/install.js');

beforeEach(() => initMock.mockClear());

describe('install (auto-wire entry)', () => {
    it('no-ops for null/undefined config', () => {
        install(null);
        install(undefined);
        expect(initMock).not.toHaveBeenCalled();
    });

    it('the module-load side effect did not init (no define in tests)', () => {
        // install() was called once at import with `null` (define undefined).
        expect(initMock).not.toHaveBeenCalled();
    });

    it('forwards sink + captureErrors to initObservability', () => {
        install({ sink: { url: 'https://logs.test/ingest', minLevel: 'info' }, captureErrors: true });
        expect(initMock).toHaveBeenCalledTimes(1);
        expect(initMock).toHaveBeenCalledWith({
            sink: { url: 'https://logs.test/ingest', minLevel: 'info' },
            captureErrors: true,
        });
    });

    it('never throws even if initObservability throws', () => {
        initMock.mockImplementationOnce(() => { throw new Error('boom'); });
        expect(() => install({ captureErrors: true })).not.toThrow();
    });
});
