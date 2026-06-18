/**
 * Opt-in OAuth helpers for `@sigx/lynx-webauth`.
 *
 * Deliberately scoped to the *frozen* parts of the spec — PKCE (RFC 7636),
 * `state` generation, and callback parsing — all pure JS with no native code.
 * Token exchange, refresh, and OIDC discovery are intentionally **out of
 * scope**: they're provider-specific and churn-prone, so they belong in your
 * app (or a future opinionated package), not in this primitive.
 *
 * Import from the subpath so the core `openAuthSession` primitive stays
 * unopinionated and these helpers tree-shake away when unused:
 *
 * ```ts
 * import { generatePKCE, generateState, parseCallback } from '@sigx/lynx-webauth/oauth';
 * ```
 */

import { parse } from '@sigx/lynx-linking';

import { sha256 } from './sha256.js';

export interface RandomOptions {
    /**
     * Supply `length` cryptographically-random bytes. Defaults to
     * `globalThis.crypto.getRandomValues`. Override in environments without a
     * Web Crypto RNG (or in tests). There is **no** insecure fallback — a
     * missing RNG throws rather than silently weakening the flow.
     */
    randomBytes?: (length: number) => Uint8Array;
}

export interface PkceChallenge {
    /** The high-entropy `code_verifier` — keep it; send it on token exchange. */
    verifier: string;
    /** The `code_challenge` derived from the verifier — send it on `/authorize`. */
    challenge: string;
    /** Challenge method. Always `'S256'` (SHA-256); `plain` is never emitted. */
    method: 'S256';
}

/**
 * Generate a PKCE `code_verifier` / `code_challenge` pair (RFC 7636, `S256`).
 *
 * The verifier is 32 random bytes → 43-char base64url string (within the
 * 43–128 range the RFC mandates); the challenge is `base64url(sha256(verifier))`.
 *
 * @example
 * ```ts
 * const { verifier, challenge, method } = await generatePKCE();
 * const authorizeUrl =
 *   `https://provider.com/authorize?response_type=code&client_id=…` +
 *   `&redirect_uri=myapp://cb&code_challenge=${challenge}&code_challenge_method=${method}`;
 * const result = await openAuthSession(authorizeUrl, 'myapp');
 * // …later, exchange the code together with `verifier`.
 * ```
 */
export async function generatePKCE(options: RandomOptions = {}): Promise<PkceChallenge> {
    const verifier = base64url(randomBytes(32, options));
    const challenge = base64url(sha256(utf8Bytes(verifier)));
    return { verifier, challenge, method: 'S256' };
}

/**
 * Generate a random opaque `state` value (16 bytes → base64url). Pass it on
 * `/authorize` and compare it against {@link CallbackParams.state} when the
 * callback returns, to defend against CSRF / mix-up attacks.
 */
export function generateState(options: RandomOptions = {}): string {
    return base64url(randomBytes(16, options));
}

export interface CallbackParams {
    /** Authorization code (`code` flow). */
    code?: string;
    /** The `state` echoed back — compare against the value you sent. */
    state?: string;
    /** OAuth error code (e.g. `access_denied`), if the provider returned one. */
    error?: string;
    /** Human-readable `error_description`, if present. */
    errorDescription?: string;
    /**
     * All callback params, merged from the query string and the URL fragment
     * (so implicit / `token`-in-fragment responses are covered too). The query
     * string wins on key collision.
     */
    params: Record<string, string>;
}

/**
 * Parse the callback URL returned by {@link openAuthSession} into its OAuth
 * params. Handles both `?query` (authorization-code flow) and `#fragment`
 * (implicit / token flow) responses.
 */
export function parseCallback(url: string): CallbackParams {
    const queryParams = parse(url).queryParams;
    const fragmentParams = parseFragment(url);
    // Query wins over fragment on collision.
    const params: Record<string, string> = { ...fragmentParams, ...queryParams };
    return {
        code: params.code,
        state: params.state,
        error: params.error,
        errorDescription: params.error_description,
        params,
    };
}

// Re-export the digest so advanced callers (and tests) can reach it.
export { sha256 };

// --- internals -------------------------------------------------------------

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url-encode bytes, no padding (RFC 4648 §5). */
function base64url(bytes: Uint8Array): string {
    let out = '';
    let i = 0;
    for (; i + 3 <= bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63] + B64URL[n & 63];
    }
    const rem = bytes.length - i;
    if (rem === 1) {
        const n = bytes[i] << 16;
        out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    } else if (rem === 2) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
        out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63] + B64URL[(n >> 6) & 63];
    }
    return out;
}

function randomBytes(length: number, options: RandomOptions): Uint8Array {
    if (options.randomBytes) return options.randomBytes(length);
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (c && typeof c.getRandomValues === 'function') {
        return c.getRandomValues(new Uint8Array(length));
    }
    throw new Error(
        '@sigx/lynx-webauth/oauth: no secure random source (crypto.getRandomValues) is ' +
            'available in this runtime. Pass options.randomBytes with a CSPRNG.',
    );
}

function utf8Bytes(s: string): Uint8Array {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    // Manual UTF-8 fallback for runtimes without TextEncoder.
    const bytes: number[] = [];
    for (let i = 0; i < s.length; i++) {
        let code = s.charCodeAt(i);
        if (code < 0x80) {
            bytes.push(code);
        } else if (code < 0x800) {
            bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < s.length) {
            const next = s.charCodeAt(i + 1);
            code = 0x10000 + ((code & 0x3ff) << 10) + (next & 0x3ff);
            i++;
            bytes.push(
                0xf0 | (code >> 18),
                0x80 | ((code >> 12) & 0x3f),
                0x80 | ((code >> 6) & 0x3f),
                0x80 | (code & 0x3f),
            );
        } else {
            bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        }
    }
    return new Uint8Array(bytes);
}

function parseFragment(url: string): Record<string, string> {
    const hash = url.indexOf('#');
    if (hash < 0) return {};
    const out: Record<string, string> = {};
    for (const piece of url.slice(hash + 1).split('&')) {
        if (!piece) continue;
        const eq = piece.indexOf('=');
        const key = decode(eq === -1 ? piece : piece.slice(0, eq));
        if (!key) continue;
        out[key] = eq === -1 ? '' : decode(piece.slice(eq + 1));
    }
    return out;
}

function decode(s: string): string {
    try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch {
        return s;
    }
}
