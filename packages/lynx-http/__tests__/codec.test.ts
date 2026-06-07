/**
 * Unit tests for the minimal UTF-8 TextDecoder shim — validated against
 * Node's real TextDecoder where behavior overlaps.
 */
import { describe, expect, it } from 'vitest';
import { SigxTextDecoder } from '../src/codec.js';

function enc(s: string): Uint8Array {
    return new TextEncoder().encode(s);
}

describe('SigxTextDecoder — whole-input decode', () => {
    it('decodes ASCII', () => {
        expect(new SigxTextDecoder().decode(enc('hello world'))).toBe('hello world');
    });

    it('decodes 2/3/4-byte sequences (accents, CJK, emoji)', () => {
        const s = 'héllo åäö 中文 🌍🚀';
        expect(new SigxTextDecoder().decode(enc(s))).toBe(s);
    });

    it('accepts ArrayBuffer and typed-array views', () => {
        const bytes = enc('viewé');
        expect(new SigxTextDecoder().decode(bytes.buffer as ArrayBuffer)).toBe('viewé');
        const offsetView = new Uint8Array([0, 0, ...bytes]).subarray(2);
        expect(new SigxTextDecoder().decode(offsetView)).toBe('viewé');
    });

    it('replaces invalid sequences with U+FFFD like the platform decoder', () => {
        const invalid = new Uint8Array([0x41, 0xff, 0x42, 0xc3]); // A, bad, B, truncated é
        const expected = new TextDecoder().decode(invalid);
        expect(new SigxTextDecoder().decode(invalid)).toBe(expected);
    });

    it('rejects non-utf8 labels', () => {
        expect(() => new SigxTextDecoder('utf-16')).toThrow(RangeError);
    });
});

describe('SigxTextDecoder — streaming across chunk boundaries', () => {
    it('reassembles a multi-byte char split across chunks', () => {
        const bytes = enc('a🌍b'); // 🌍 is 4 bytes
        const d = new SigxTextDecoder();
        let out = '';
        // Split right through the middle of the emoji.
        out += d.decode(bytes.subarray(0, 3), { stream: true });
        out += d.decode(bytes.subarray(3), { stream: true });
        out += d.decode();
        expect(out).toBe('a🌍b');
    });

    it('matches Node TextDecoder over many random split points', () => {
        const s = 'data: {"tok":"héllo🌍"}\n\ndata: 中文 done\n\n';
        const bytes = enc(s);
        for (let split = 1; split < bytes.length; split++) {
            const ours = new SigxTextDecoder();
            const node = new TextDecoder();
            const a = ours.decode(bytes.subarray(0, split), { stream: true })
                + ours.decode(bytes.subarray(split), { stream: true })
                + ours.decode();
            const b = node.decode(bytes.subarray(0, split), { stream: true })
                + node.decode(bytes.subarray(split), { stream: true })
                + node.decode();
            expect(a).toBe(b);
        }
        // Sanity: the reassembled text is the original.
        expect(new SigxTextDecoder().decode(bytes)).toBe(s);
    });

    it('flushes an incomplete trailing sequence as U+FFFD on final decode', () => {
        const d = new SigxTextDecoder();
        const partial = enc('é').subarray(0, 1); // first byte of a 2-byte seq
        let out = d.decode(partial, { stream: true });
        expect(out).toBe('');
        out += d.decode(); // flush — Node emits U+FFFD here too
        expect(out).toBe(new TextDecoder().decode(partial));
    });
});
