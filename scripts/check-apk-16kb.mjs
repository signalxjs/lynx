#!/usr/bin/env node
// Assert that every native library packaged in an APK can load on a 16 KB
// page-size Android device (Android 15+, e.g. the Pixel 16 KB AVDs).
//
//   node scripts/check-apk-16kb.mjs <app.apk> [more.apk …]
//
// Two properties are checked for each `lib/<abi>/*.so` of a 64-bit ABI
// (arm64-v8a, x86_64; 16 KB pages exist only there):
//
//   1. ELF: every PT_LOAD segment's p_align is >= 16384. A library linked for
//      4 KB / 8 KB pages fails dlopen with "program alignment (8192) cannot be
//      smaller than system page size (16384)" (#1251: Fresco 2.3.0's
//      libimagepipeline.so crashed every image load).
//   2. ZIP: a library stored uncompressed (loaded straight from the APK) starts
//      at a 16 KB-aligned offset. Compressed libraries are extracted at install
//      time, so their zip offset does not matter.
//
// 32-bit ABIs are listed for information only. Exits 1 on any violation.
//
// Necessary, not sufficient: Fresco 2.3.0's arm64 libimagepipeline.so declares
// p_align 65536 and passes both checks, yet an Android 17 16 KB emulator still
// refused it ("program alignment (8192)") when SoLoader loaded its extracted
// copy. A device/emulator run on a 16 KB image stays the final word; this
// script catches the common failure (4 KB-linked libraries) without one.
// Pure Node (no Android SDK needed), so CI can run it on a built APK; the SDK
// equivalents are `zipalign -c -P 16 -v 4 app.apk` and
// `llvm-readelf -lW lib.so` (look at the LOAD rows' Align column).

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
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

function main() {
    const apks = process.argv.slice(2);
    if (apks.length === 0) {
        console.error('usage: node scripts/check-apk-16kb.mjs <app.apk> [more.apk …]');
        process.exit(2);
    }
    let failed = false;
    for (const apk of apks) {
        const { checked, failures, info } = checkApk(apk);
        if (checked === 0) {
            console.log(`${apk}: no 64-bit native libraries — nothing to check`);
        } else if (failures.length === 0) {
            console.log(`${apk}: OK — ${checked} 64-bit native libraries are 16 KB page-compatible`);
        } else {
            failed = true;
            console.error(`${apk}: ${failures.length} of ${checked} 64-bit native libraries cannot load on 16 KB-page devices:`);
            for (const f of failures) console.error(`  ✗ ${f}`);
        }
        if (info.length) {
            console.log(`  (32-bit ABIs, informational — no 16 KB-page devices run them: ${info.length} under-aligned)`);
        }
    }
    process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
