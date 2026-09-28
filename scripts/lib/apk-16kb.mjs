/**
 * apk-16kb.mjs — zip + ELF inspection behind `scripts/check-apk-16kb.mjs`
 * (#1251): can every 64-bit native library in an APK load on a 16 KB-page
 * Android device? See the CLI script's header for what is checked and why.
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const PAGE = 16384;
const ABIS_64 = new Set(['arm64-v8a', 'x86_64']);

/** Parse the central directory of a zip buffer. */
export function zipEntries(buf) {
    // End of central directory record: signature 0x06054b50, scanned from the end
    // (a trailing comment can be up to 64 KiB).
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
    let count = buf.readUInt16LE(eocd + 10);
    let offset = buf.readUInt32LE(eocd + 16);
    // ZIP64 (entry count / offset overflow): locator sits right before the EOCD.
    if (count === 0xffff || offset === 0xffffffff) {
        const loc = eocd - 20;
        if (buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip64 locator missing');
        const z64 = Number(buf.readBigUInt64LE(loc + 8));
        count = Number(buf.readBigUInt64LE(z64 + 32));
        offset = Number(buf.readBigUInt64LE(z64 + 48));
    }
    const out = [];
    for (let n = 0; n < count; n++) {
        if (buf.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad central directory entry');
        const method = buf.readUInt16LE(offset + 10);
        let compSize = buf.readUInt32LE(offset + 20);
        let size = buf.readUInt32LE(offset + 24);
        const nameLen = buf.readUInt16LE(offset + 28);
        const extraLen = buf.readUInt16LE(offset + 30);
        const commentLen = buf.readUInt16LE(offset + 32);
        let localOffset = buf.readUInt32LE(offset + 42);
        const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
        // ZIP64 extended info in the central extra field.
        let e = offset + 46 + nameLen;
        const eEnd = e + extraLen;
        while (e + 4 <= eEnd) {
            const id = buf.readUInt16LE(e);
            const len = buf.readUInt16LE(e + 2);
            if (id === 0x0001) {
                let p = e + 4;
                if (size === 0xffffffff) { size = Number(buf.readBigUInt64LE(p)); p += 8; }
                if (compSize === 0xffffffff) { compSize = Number(buf.readBigUInt64LE(p)); p += 8; }
                if (localOffset === 0xffffffff) { localOffset = Number(buf.readBigUInt64LE(p)); }
            }
            e += 4 + len;
        }
        const lNameLen = buf.readUInt16LE(localOffset + 26);
        const lExtraLen = buf.readUInt16LE(localOffset + 28);
        const dataOffset = localOffset + 30 + lNameLen + lExtraLen;
        out.push({ name, method, compSize, size, dataOffset });
        offset += 46 + nameLen + extraLen + commentLen;
    }
    return out;
}

/** Smallest PT_LOAD p_align of an ELF image, or null when it has none. */
export function minLoadAlign(elf) {
    if (elf.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF file');
    const is64 = elf[4] === 2;
    const le = elf[5] === 1;
    const u16 = (o) => (le ? elf.readUInt16LE(o) : elf.readUInt16BE(o));
    const u32 = (o) => (le ? elf.readUInt32LE(o) : elf.readUInt32BE(o));
    const u64 = (o) => Number(le ? elf.readBigUInt64LE(o) : elf.readBigUInt64BE(o));
    const phoff = is64 ? u64(0x20) : u32(0x1c);
    const phentsize = u16(is64 ? 0x36 : 0x2a);
    const phnum = u16(is64 ? 0x38 : 0x2c);
    let min = null;
    for (let i = 0; i < phnum; i++) {
        const ph = phoff + i * phentsize;
        if (u32(ph) !== 1 /* PT_LOAD */) continue;
        const align = is64 ? u64(ph + 0x30) : u32(ph + 0x1c);
        if (min === null || align < min) min = align;
    }
    return min;
}

/** Check one APK (path or Buffer): `{ checked, failures, info }`. */
export function checkApk(apk) {
    const buf = typeof apk === 'string' ? readFileSync(apk) : apk;
    const failures = [];
    const info = [];
    let checked = 0;
    for (const entry of zipEntries(buf)) {
        const m = /^lib\/([^/]+)\/([^/]+\.so)$/.exec(entry.name);
        if (!m) continue;
        const [, abi, lib] = m;
        const raw = buf.subarray(entry.dataOffset, entry.dataOffset + entry.compSize);
        // APKs store (0) or deflate (8) entries; anything else is unreadable here.
        if (entry.method !== 0 && entry.method !== 8) {
            throw new Error(`${entry.name}: unsupported zip compression method ${entry.method}`);
        }
        const elf = entry.method === 0 ? raw : inflateRawSync(raw);
        const align = minLoadAlign(elf);
        const problems = [];
        if (align !== null && align < PAGE) problems.push(`LOAD segment p_align ${align}`);
        if (entry.method === 0 && entry.dataOffset % PAGE !== 0) {
            problems.push(`stored at zip offset ${entry.dataOffset} (not a multiple of ${PAGE})`);
        }
        if (!ABIS_64.has(abi)) {
            if (problems.length) info.push(`${abi}/${lib}: ${problems.join('; ')}`);
            continue;
        }
        checked++;
        if (problems.length) failures.push(`${abi}/${lib}: ${problems.join('; ')}`);
    }
    return { checked, failures, info };
}
