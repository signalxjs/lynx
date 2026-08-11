/**
 * Native FileSystem surface — the path that ships on iOS and Android.
 *
 * The package had no behavioural tests at all, which is how the C4 defect
 * survived: both natives resolve `{ error: string }` on failure instead of
 * rejecting, so every failure used to arrive as a *success value* typed as
 * `string`/`void`/`FileInfo`. These drive the real `@sigx/lynx-core` bridge
 * against a faked `NativeModules` global, so the callback convention and the
 * unwrap are exercised rather than mocked away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileSystem } from '../src/file-system';

type NativeImpl = Record<string, (...a: never[]) => unknown>;

/** Records what crossed the bridge, so call shape is asserted, not assumed. */
let calls: Array<{ method: string; args: unknown[] }>;

/** Install a fake `FileSystem` native module. `undefined` unlinks it. */
function installNativeModules(impl?: NativeImpl) {
    vi.stubGlobal('NativeModules', impl ? { FileSystem: impl } : {});
}

/**
 * A native method that records its arguments and resolves `result` — the
 * shape both platforms use: last argument is the callback, and a failure is a
 * resolved `{ error }`, never a throw.
 */
function resolving(method: string, result: unknown): (...a: never[]) => void {
    return (...args: never[]) => {
        const cb = args[args.length - 1] as unknown as (r: unknown) => void;
        calls.push({ method, args: args.slice(0, -1) });
        cb(result);
    };
}

beforeEach(() => {
    calls = [];
    installNativeModules({
        readFile: resolving('readFile', 'file contents'),
        readFileBase64: resolving('readFileBase64', 'aGk='),
        writeFile: resolving('writeFile', true),
        deleteFile: resolving('deleteFile', true),
        getInfo: resolving('getInfo', {
            uri: '/docs/data.json',
            size: 12,
            exists: true,
            isDirectory: false,
            modifiedAt: 1_700_000_000_000,
        }),
        getDocumentDirectory: () => '/docs',
        getCacheDirectory: () => '/cache',
    });
});

afterEach(() => vi.unstubAllGlobals());

describe('FileSystem.readFile', () => {
    it('resolves the file contents', async () => {
        await expect(FileSystem.readFile('data.json')).resolves.toBe('file contents');
        expect(calls).toEqual([{ method: 'readFile', args: ['data.json'] }]);
    });

    it('rejects on the native { error } envelope', async () => {
        // Used to resolve the envelope object typed as `string`, so
        // `content.length` read `undefined` and no try/catch ever fired.
        installNativeModules({
            readFile: resolving('readFile', { error: 'File not found: missing.json' }),
        });
        await expect(FileSystem.readFile('missing.json')).rejects.toThrow(
            '[@sigx/lynx-file-system] readFile failed: File not found: missing.json',
        );
    });

    it('rejects with a branchable code, not just a message', async () => {
        installNativeModules({ readFile: resolving('readFile', { error: 'EACCES' }) });
        await expect(FileSystem.readFile('locked')).rejects.toMatchObject({
            code: 'native_error',
            package: 'lynx-file-system',
        });
    });
});

describe('FileSystem.readFileBase64', () => {
    it('resolves the base64 payload', async () => {
        await expect(FileSystem.readFileBase64('pic.png')).resolves.toBe('aGk=');
    });

    it('rejects on the native { error } envelope, prefixed exactly once', async () => {
        // The hand-rolled unwrap this replaced threw `[@sigx/lynx-file-system]
        // <native message>` — no `<action> failed:` — so pin the whole string
        // to catch both a dropped action and a double prefix.
        installNativeModules({
            readFileBase64: resolving('readFileBase64', { error: 'Could not open stream' }),
        });
        await expect(FileSystem.readFileBase64('pic.png')).rejects.toMatchObject({
            message: '[@sigx/lynx-file-system] readFileBase64 failed: Could not open stream',
        });
    });

    it('rejects rather than handing back a non-string payload', async () => {
        installNativeModules({ readFileBase64: resolving('readFileBase64', null) });
        await expect(FileSystem.readFileBase64('pic.png')).rejects.toThrow(
            /readFileBase64 failed: unexpected payload/,
        );
    });

    it('propagates the failure through readFileAsArrayBuffer', async () => {
        // The decode helper must not turn a native failure into an empty buffer.
        installNativeModules({
            readFileBase64: resolving('readFileBase64', { error: 'File not found: pic.png' }),
        });
        await expect(FileSystem.readFileAsArrayBuffer('pic.png')).rejects.toMatchObject({
            code: 'native_error',
            // Pin the native cause, not just the code: the fallback throw for a
            // non-string payload carries `native_error` too, so a code-only
            // assertion would still pass with the unwrap removed.
            message: '[@sigx/lynx-file-system] readFileBase64 failed: File not found: pic.png',
        });
    });
});

describe('FileSystem.writeFile', () => {
    it('resolves once the native side confirms the write', async () => {
        await expect(FileSystem.writeFile('data.json', '{}')).resolves.toBeUndefined();
        expect(calls).toEqual([{ method: 'writeFile', args: ['data.json', '{}'] }]);
    });

    it('rejects when the write fails', async () => {
        // A failed write looked exactly like a successful one before C4.
        installNativeModules({
            writeFile: resolving('writeFile', { error: 'No space left on device' }),
        });
        await expect(FileSystem.writeFile('big.bin', 'x')).rejects.toThrow(
            '[@sigx/lynx-file-system] writeFile failed: No space left on device',
        );
    });
});

describe('FileSystem.deleteFile', () => {
    it('resolves on a successful delete', async () => {
        await expect(FileSystem.deleteFile('data.json')).resolves.toBeUndefined();
        expect(calls).toEqual([{ method: 'deleteFile', args: ['data.json'] }]);
    });

    it('stays a no-op for a file that is already gone', async () => {
        // Both natives now report success for a missing path (iOS used to
        // resolve removeItem's "no such file" envelope), so the README's
        // "no-op if the file doesn't exist" survives the unwrap.
        installNativeModules({ deleteFile: resolving('deleteFile', true) });
        await expect(FileSystem.deleteFile('already-gone.json')).resolves.toBeUndefined();
    });

    it('rejects when the delete genuinely fails', async () => {
        installNativeModules({
            deleteFile: resolving('deleteFile', { error: 'Failed to delete: /docs/sub' }),
        });
        await expect(FileSystem.deleteFile('/docs/sub')).rejects.toThrow(
            '[@sigx/lynx-file-system] deleteFile failed: Failed to delete: /docs/sub',
        );
    });
});

describe('FileSystem.getInfo', () => {
    it('resolves the FileInfo record', async () => {
        await expect(FileSystem.getInfo('data.json')).resolves.toMatchObject({
            uri: '/docs/data.json',
            exists: true,
        });
    });

    it('resolves exists:false for a missing file rather than throwing', async () => {
        // Absence is a stat *result*, not a failure — the unwrap must not
        // turn the common "does this exist?" call into a rejection.
        installNativeModules({
            getInfo: resolving('getInfo', {
                uri: '/docs/missing.json',
                size: 0,
                exists: false,
                isDirectory: false,
                modifiedAt: 0,
            }),
        });
        await expect(FileSystem.getInfo('missing.json')).resolves.toMatchObject({ exists: false });
    });

    it('rejects when the native stat fails', async () => {
        installNativeModules({ getInfo: resolving('getInfo', { error: 'EACCES' }) });
        await expect(FileSystem.getInfo('/root/secret')).rejects.toThrow(
            '[@sigx/lynx-file-system] getInfo failed: EACCES',
        );
    });
});

describe('when the native module is not linked', () => {
    it('rejects with core’s descriptive error (C3)', async () => {
        installNativeModules();
        await expect(FileSystem.readFile('data.json')).rejects.toThrow(
            /Module "FileSystem" is not available/,
        );
        expect(FileSystem.isAvailable()).toBe(false);
    });
});
