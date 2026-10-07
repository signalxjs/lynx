/**
 * Cryptographically secure random bytes (#1337).
 *
 * Lynx's background-thread engine has no Web Crypto on iOS, so
 * `crypto.getRandomValues` is missing exactly where OAuth/PKCE code runs.
 * Core's own native module (`SigxCore`) — linked in every build — fills the
 * gap with the platform CSPRNG (`SecRandomCopyBytes` / `SecureRandom`).
 */

import { base64ToArrayBuffer } from './base64.js';
import { callSync, isModuleAvailable } from './bridge.js';
import { SigxError } from './errors.js';

const MODULE = 'SigxCore';
const PKG = 'lynx-core';
/** Upper bound per call — matches the native guard. */
const MAX_LENGTH = 1024;

/**
 * Return `length` cryptographically secure random bytes (1–1024).
 *
 * Uses `crypto.getRandomValues` where the runtime has it (web builds, engines
 * with Web Crypto), else core's native CSPRNG. Synchronous on both paths.
 * There is **no** insecure fallback: with neither source available it throws
 * a `SigxError` with `code: 'no_random_source'`.
 *
 * @throws {SigxError} `'invalid_argument'` for a length that isn't an integer
 *   in 1–1024; `'no_random_source'` when no CSPRNG is available.
 *
 * @example
 * ```ts
 * import { getRandomBytes } from '@sigx/lynx-core';
 * const nonce = getRandomBytes(16);
 * ```
 */
export function getRandomBytes(length: number): Uint8Array {
    if (!Number.isInteger(length) || length < 1 || length > MAX_LENGTH) {
        throw new SigxError(
            PKG,
            'invalid_argument',
            `[@sigx/${PKG}] getRandomBytes failed: length must be an integer from 1 to ${MAX_LENGTH}, got ${String(length)}.`,
        );
    }

    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.getRandomValues === 'function') {
        return c.getRandomValues(new Uint8Array(length));
    }

    if (isModuleAvailable(MODULE)) {
        const b64 = callSync<string>(MODULE, 'getRandomBytes', length);
        // An empty or short result means the native CSPRNG refused or failed —
        // never hand back fewer bytes than asked for.
        if (typeof b64 === 'string' && b64.length > 0) {
            const bytes = new Uint8Array(base64ToArrayBuffer(b64));
            if (bytes.length === length) return bytes;
        }
    }

    throw new SigxError(
        PKG,
        'no_random_source',
        `[@sigx/${PKG}] getRandomBytes failed: no secure random source is available ` +
            '(no crypto.getRandomValues, and the native SigxCore CSPRNG is missing or failed).',
    );
}
