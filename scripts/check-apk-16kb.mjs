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

import { checkApk } from './lib/apk-16kb.mjs';

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

main();
