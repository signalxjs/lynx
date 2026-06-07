/**
 * Minimal incremental UTF-8 decoder — the Lynx BG runtime ships no
 * `TextDecoder`, and both `Response.text()` and portable SSE code
 * (`new TextDecoder().decode(value, { stream: true })`) need one.
 *
 * Supports exactly the surface that fetch/SSE consumers use: utf-8 only,
 * `{ stream }` option, invalid sequences replaced with U+FFFD. Installed
 * on `globalThis` as `TextDecoder` by `src/index.ts` when absent.
 */
export class SigxTextDecoder {
    readonly encoding = 'utf-8';
    readonly fatal = false;
    readonly ignoreBOM = false;

    /** Trailing bytes of an incomplete sequence from the previous chunk. */
    private pending: number[] = [];

    constructor(label?: string) {
        const l = (label ?? 'utf-8').toLowerCase();
        if (l !== 'utf-8' && l !== 'utf8' && l !== 'unicode-1-1-utf-8') {
            throw new RangeError(`TextDecoder: only utf-8 is supported, got "${label}"`);
        }
    }

    decode(input?: ArrayBuffer | ArrayBufferView, options?: { stream?: boolean }): string {
        const stream = options?.stream === true;
        let bytes: Uint8Array;
        if (input === undefined) {
            bytes = new Uint8Array(0);
        } else if (input instanceof Uint8Array) {
            bytes = input;
        } else if (ArrayBuffer.isView(input)) {
            bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
        } else {
            bytes = new Uint8Array(input);
        }

        // Prepend leftovers from the previous streamed chunk.
        let buf: Uint8Array;
        if (this.pending.length > 0) {
            buf = new Uint8Array(this.pending.length + bytes.length);
            buf.set(this.pending, 0);
            buf.set(bytes, this.pending.length);
            this.pending = [];
        } else {
            buf = bytes;
        }

        let out = '';
        let i = 0;
        const n = buf.length;
        while (i < n) {
            const b0 = buf[i];
            // ASCII fast path.
            if (b0 < 0x80) {
                out += String.fromCharCode(b0);
                i++;
                continue;
            }
            // Determine sequence length from the lead byte.
            let len: number;
            let cp: number;
            if (b0 >= 0xc2 && b0 <= 0xdf) { len = 2; cp = b0 & 0x1f; }
            else if (b0 >= 0xe0 && b0 <= 0xef) { len = 3; cp = b0 & 0x0f; }
            else if (b0 >= 0xf0 && b0 <= 0xf4) { len = 4; cp = b0 & 0x07; }
            else {
                out += '�';
                i++;
                continue;
            }
            // Incomplete tail — stash for the next streamed chunk.
            if (i + len > n) {
                if (stream) {
                    this.pending = Array.from(buf.subarray(i));
                    return out;
                }
                out += '�';
                break;
            }
            let valid = true;
            for (let j = 1; j < len; j++) {
                const bj = buf[i + j];
                if ((bj & 0xc0) !== 0x80) { valid = false; break; }
                cp = (cp << 6) | (bj & 0x3f);
            }
            // Reject overlongs / surrogates / out-of-range.
            if (!valid
                || (len === 3 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)))
                || (len === 4 && (cp < 0x10000 || cp > 0x10ffff))) {
                out += '�';
                i++;
                continue;
            }
            if (cp > 0xffff) {
                cp -= 0x10000;
                out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
            } else {
                out += String.fromCharCode(cp);
            }
            i += len;
        }
        return out;
    }
}
