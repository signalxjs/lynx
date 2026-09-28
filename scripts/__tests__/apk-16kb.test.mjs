import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import { checkApk, minLoadAlign } from '../lib/apk-16kb.mjs';

/** A minimal little-endian ELF64 image with one PT_LOAD per entry of `aligns`. */
function elf64(aligns) {
    const phoff = 64;
    const buf = Buffer.alloc(phoff + 56 * aligns.length + 16);
    buf.writeUInt32BE(0x7f454c46, 0);
    buf[4] = 2; // ELFCLASS64
    buf[5] = 1; // little-endian
    buf.writeBigUInt64LE(BigInt(phoff), 0x20);
    buf.writeUInt16LE(56, 0x36);
    buf.writeUInt16LE(aligns.length, 0x38);
    aligns.forEach((align, i) => {
        const ph = phoff + i * 56;
        buf.writeUInt32LE(1, ph); // PT_LOAD
        buf.writeBigUInt64LE(BigInt(align), ph + 0x30);
    });
    return buf;
}

/**
 * Build a zip. Each entry: { name, data, stored, align } — `align` pads the
 * local header's extra field so a stored entry's data starts on that boundary.
 */
function zip(entries) {
    const parts = [];
    const central = [];
    let offset = 0;
    for (const e of entries) {
        const name = Buffer.from(e.name);
        const body = e.stored ? e.data : deflateRawSync(e.data);
        let extraLen = 0;
        if (e.align) {
            const start = offset + 30 + name.length;
            extraLen = (e.align - (start % e.align)) % e.align;
        }
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(e.stored ? 0 : 8, 8);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(e.data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(extraLen, 28);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(e.stored ? 0 : 8, 10);
        cd.writeUInt32LE(body.length, 20);
        cd.writeUInt32LE(e.data.length, 24);
        cd.writeUInt16LE(name.length, 28);
        cd.writeUInt32LE(offset, 42);
        central.push(Buffer.concat([cd, name]));
        const chunk = Buffer.concat([local, name, Buffer.alloc(extraLen), body]);
        parts.push(chunk);
        offset += chunk.length;
    }
    const cdBuf = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(cdBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, cdBuf, eocd]);
}

describe('minLoadAlign', () => {
    it('returns the smallest PT_LOAD alignment', () => {
        expect(minLoadAlign(elf64([16384, 4096]))).toBe(4096);
        expect(minLoadAlign(elf64([65536, 16384]))).toBe(16384);
    });
});

describe('checkApk', () => {
    it('passes 16 KB-aligned libraries, stored or compressed', () => {
        const apk = zip([
            { name: 'lib/arm64-v8a/liba.so', data: elf64([16384, 16384]), stored: true, align: 16384 },
            { name: 'lib/x86_64/libb.so', data: elf64([65536]) },
            { name: 'classes.dex', data: Buffer.from('dex') },
        ]);
        expect(checkApk(apk)).toEqual({ checked: 2, failures: [], info: [] });
    });

    it('flags a 4 KB-linked 64-bit library (the Fresco 2.3.0 x86_64 case)', () => {
        const apk = zip([{ name: 'lib/x86_64/libimagepipeline.so', data: elf64([4096, 4096]) }]);
        const { failures } = checkApk(apk);
        expect(failures).toEqual(['x86_64/libimagepipeline.so: LOAD segment p_align 4096']);
    });

    it('flags an uncompressed library at a non-16 KB zip offset', () => {
        const apk = zip([{ name: 'lib/arm64-v8a/liba.so', data: elf64([16384]), stored: true, align: 4096 }]);
        const { failures } = checkApk(apk);
        // Offset 4096 is 4 KB- but not 16 KB-aligned.
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatch(/zip offset \d+ \(not a multiple of 16384\)/);
    });

    it('rejects a compression method other than stored or deflate', () => {
        const apk = zip([{ name: 'lib/arm64-v8a/liba.so', data: elf64([16384]), stored: true }]);
        // Rewrite the method field (local header and central directory) to 12 (bzip2).
        apk.writeUInt16LE(12, 8);
        apk.writeUInt16LE(12, apk.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
        expect(() => checkApk(apk)).toThrow(/unsupported zip compression method 12/);
    });

    it('reports 32-bit ABIs as information, never failures', () => {
        const apk = zip([{ name: 'lib/armeabi-v7a/liba.so', data: elf64([4096]) }]);
        const result = checkApk(apk);
        expect(result.checked).toBe(0);
        expect(result.failures).toEqual([]);
        expect(result.info).toHaveLength(1);
    });
});
