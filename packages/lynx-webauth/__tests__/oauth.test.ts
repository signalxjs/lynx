/**
 * Unit tests for the opt-in OAuth helpers. These are pure JS (no native
 * bridge), so they verify the frozen-standard behavior directly against
 * published test vectors.
 */
import { describe, expect, it } from 'vitest';

import { generatePKCE, generateState, parseCallback, sha256 } from '../src/oauth.js';

function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

function utf8(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

describe('sha256 (FIPS 180-4 vectors)', () => {
    it('hashes the empty string', () => {
        expect(toHex(sha256(utf8('')))).toBe(
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        );
    });

    it('hashes "abc"', () => {
        expect(toHex(sha256(utf8('abc')))).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });

    it('hashes a 56-byte message (crosses a block boundary)', () => {
        expect(
            toHex(sha256(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
        ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
    });
});

describe('generatePKCE (RFC 7636 Appendix B)', () => {
    // The exact octet sequence from RFC 7636 Appendix B.
    const RFC_OCTETS = new Uint8Array([
        116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77,
        105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
    ]);

    it('derives the RFC verifier + S256 challenge from the spec octets', async () => {
        const { verifier, challenge, method } = await generatePKCE({
            randomBytes: () => RFC_OCTETS,
        });
        expect(verifier).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
        expect(challenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
        expect(method).toBe('S256');
    });

    it('produces a 43-char base64url verifier from the default CSPRNG', async () => {
        const { verifier } = await generatePKCE();
        expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });

    it('propagates a missing-RNG error (no insecure fallback)', async () => {
        // The default path throws when crypto.getRandomValues is absent; an
        // injector that throws stands in for that runtime here.
        await expect(
            generatePKCE({
                randomBytes: () => {
                    throw new Error('no secure random source');
                },
            }),
        ).rejects.toThrow(/no secure random source/);
    });
});

describe('generateState', () => {
    it('returns a base64url string from injected bytes', () => {
        const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
        expect(generateState({ randomBytes: () => bytes })).toBe('AAECAwQFBgcICQoLDA0ODw');
    });

    it('defaults to a 22-char base64url string (16 bytes)', () => {
        expect(generateState()).toMatch(/^[A-Za-z0-9_-]{22}$/);
    });
});

describe('parseCallback', () => {
    it('extracts code + state from the query string', () => {
        const r = parseCallback('myapp://cb?code=abc123&state=xyz');
        expect(r.code).toBe('abc123');
        expect(r.state).toBe('xyz');
        expect(r.error).toBeUndefined();
        expect(r.params).toMatchObject({ code: 'abc123', state: 'xyz' });
    });

    it('extracts error + error_description', () => {
        const r = parseCallback('myapp://cb?error=access_denied&error_description=Nope%20out');
        expect(r.error).toBe('access_denied');
        expect(r.errorDescription).toBe('Nope out');
        expect(r.code).toBeUndefined();
    });

    it('reads params from the URL fragment (implicit / token flow)', () => {
        const r = parseCallback('myapp://cb#access_token=tok123&state=s2&token_type=bearer');
        expect(r.params.access_token).toBe('tok123');
        expect(r.params.token_type).toBe('bearer');
        expect(r.state).toBe('s2');
    });

    it('lets the query string win over the fragment on key collision', () => {
        const r = parseCallback('myapp://cb?state=fromQuery#state=fromFragment');
        expect(r.state).toBe('fromQuery');
    });
});
