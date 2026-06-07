/**
 * base64 ↔ ArrayBuffer codecs for binary data crossing the JS↔native
 * bridge (which is JSON-shaped — binary travels as base64 strings).
 *
 * Originally private to `@sigx/lynx-websocket`; extracted here once
 * `@sigx/lynx-file-system` became the second consumer.
 */

/**
 * Decode a base64 string into an `ArrayBuffer`. Lynx's BTS runtime has
 * `atob` per the platform docs, but fall back to a manual decoder to keep
 * this portable across hosts where it might be absent.
 */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
    if (typeof atob === 'function') {
        const bin = atob(b64);
        const buf = new ArrayBuffer(bin.length);
        const view = new Uint8Array(buf);
        for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
        return buf;
    }
    // Pure-JS fallback. Not the fastest, but executed only on hosts that
    // ship no atob (vanishingly rare).
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Int8Array(256).fill(-1);
    for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;
    const clean = b64.replace(/=+$/, '');
    const out = new Uint8Array((clean.length * 3) >> 2);
    let p = 0;
    let buf = 0;
    let bits = 0;
    for (let i = 0; i < clean.length; i++) {
        const v = lookup[clean.charCodeAt(i)];
        if (v < 0) continue;
        buf = (buf << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[p++] = (buf >> bits) & 0xff;
        }
    }
    // Skipped characters (whitespace/newlines) make the preallocation an
    // over-estimate — size the result to what was actually decoded.
    return p === out.length ? out.buffer : out.buffer.slice(0, p);
}

/**
 * Encode an `ArrayBuffer` / typed-array view to base64 for transport to
 * native. Views are honored over their active `byteOffset`/`byteLength`
 * range only. Native side base64-decodes back to raw bytes.
 */
export function arrayBufferToBase64(buf: ArrayBuffer | ArrayBufferView): string {
    const bytes = buf instanceof Uint8Array
        ? buf
        : ArrayBuffer.isView(buf)
            ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
            : new Uint8Array(buf);
    if (typeof btoa === 'function') {
        // Build the binary string in chunks to dodge call-stack limits on
        // large payloads (String.fromCharCode.apply blows up around ~64k args).
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
        }
        return btoa(bin);
    }
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
        out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + chars[(n >> 6) & 63] + chars[n & 63];
    }
    if (i < bytes.length) {
        const rem = bytes.length - i;
        const n = rem === 1 ? bytes[i] << 16 : (bytes[i] << 16) | (bytes[i + 1] << 8);
        out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
        out += rem === 2 ? chars[(n >> 6) & 63] + '=' : '==';
    }
    return out;
}
