/**
 * Runtime orientation lock. The bridge has no error channel — every native
 * call resolves with its callback payload — so failures ride `{ error }`
 * (CONVENTIONS.md C4) and the wrapper turns them back into scoped rejections
 * (C10). That translation is the whole surface worth pinning here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const callAsync = vi.fn();
const isModuleAvailable = vi.fn(() => true);

vi.mock('../src/bridge.js', () => ({ callAsync, isModuleAvailable }));

const { Orientation } = await import('../src/orientation.js');
const { isSigxError } = await import('../src/errors.js');

beforeEach(() => {
    callAsync.mockReset();
    isModuleAvailable.mockReset();
    isModuleAvailable.mockReturnValue(true);
});

describe('Orientation.lock', () => {
    it('calls SigxCore.lockOrientation with the requested value', async () => {
        callAsync.mockResolvedValue({});
        await Orientation.lock('landscape');
        expect(callAsync).toHaveBeenCalledWith(
            'SigxCore', 'lockOrientation', { orientation: 'landscape' },
        );
    });

    it("routes 'default' to unlock — native knows nothing about that value", async () => {
        // It is documented as an alias for `unlock()`, and both native sides
        // treat it as an unknown orientation, so forwarding it would reject a
        // documented value.
        callAsync.mockResolvedValue({});
        await Orientation.lock('default');
        expect(callAsync).toHaveBeenCalledWith('SigxCore', 'unlockOrientation');
        expect(callAsync).not.toHaveBeenCalledWith(
            'SigxCore', 'lockOrientation', expect.anything(),
        );
    });

    it('rejects with a scoped message when the build forbids it', async () => {
        callAsync.mockResolvedValue({
            error: "The app is built with a fixed orientation, so lock('landscape') can't take effect.",
        });
        await expect(Orientation.lock('landscape')).rejects.toThrow(
            /^\[@sigx\/lynx-core\] lock\('landscape'\) failed: The app is built with a fixed orientation/,
        );
    });

    it('rejects with a typed SigxError callers can branch on', async () => {
        callAsync.mockResolvedValue({ error: 'No foreground Activity' });
        // The message is for humans; `code` is the branchable contract (C10).
        await expect(Orientation.lock('portrait')).rejects.toSatisfy(
            (e: unknown) => isSigxError(e) && e.code === 'native_error' && e.package === 'lynx-core',
        );
    });

    it('resolves on an empty result map and when native answers with nothing', async () => {
        // Success is the ABSENCE of `error` — an older host that acknowledges
        // without a payload must not look like a failure.
        callAsync.mockResolvedValue({});
        await expect(Orientation.lock('portrait')).resolves.toBeUndefined();
        callAsync.mockResolvedValue(undefined);
        await expect(Orientation.lock('portrait')).resolves.toBeUndefined();
    });

    it('propagates a thrown bridge error (module not linked)', async () => {
        callAsync.mockRejectedValue(new Error('SigxCore is not available'));
        await expect(Orientation.lock('all')).rejects.toThrow('SigxCore is not available');
    });
});

describe('Orientation.unlock', () => {
    it('calls SigxCore.unlockOrientation with no arguments', async () => {
        callAsync.mockResolvedValue({});
        await Orientation.unlock();
        expect(callAsync).toHaveBeenCalledWith('SigxCore', 'unlockOrientation');
    });

    it('rejects on an explicit native failure', async () => {
        callAsync.mockResolvedValue({ error: 'No foreground Activity' });
        await expect(Orientation.unlock()).rejects.toThrow(
            '[@sigx/lynx-core] unlock failed: No foreground Activity',
        );
    });
});

describe('Orientation.isAvailable', () => {
    it('feature-detects the core module', () => {
        isModuleAvailable.mockReturnValue(false);
        expect(Orientation.isAvailable()).toBe(false);
        expect(isModuleAvailable).toHaveBeenCalledWith('SigxCore');
    });
});
