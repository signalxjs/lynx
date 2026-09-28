/**
 * Android host fixes from the #1140 fix wave:
 *  - #1266 — release (R8 full mode) builds keep Room's generated database
 *    constructor, which WorkManager instantiates reflectively at startup.
 *  - #1260 — the host registers a TypefaceCache provider for the CSS generic
 *    font families, which Android Lynx never resolves on its own.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scaffoldAndroid, refreshAndroidManagedFiles } from '../src/prebuild.js';
import { linkAndroid } from '../src/autolink/android.js';
import { resolveConfig } from '../src/config/parser.js';
import { validateManifest, type ModuleManifest } from '../src/manifest.js';
import type { LynxConfig } from '../src/config/schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoPackages = join(here, '..', '..');

const CONFIG: LynxConfig = {
    name: 'TestApp',
    version: '1.0.0',
    modules: [],
    platforms: ['android'],
    android: { applicationId: 'com.test.fonts', minSdk: 26, targetSdk: 35, compileSdk: 35 },
};

let testDir: string;
beforeEach(() => {
    testDir = join(tmpdir(), `sigx-startup-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
});
afterEach(() => rmSync(testDir, { recursive: true, force: true }));

describe('#1266 — WorkManager survives R8 full mode', () => {
    const manifest = JSON.parse(
        readFileSync(join(repoPackages, 'lynx-background', 'signalx-module.json'), 'utf-8'),
    ) as ModuleManifest;

    it('lynx-background keeps the RoomDatabase subclasses\' no-arg constructor', () => {
        expect(validateManifest(manifest)).toEqual([]);
        // R8 full mode drops the implicit default constructor of a
        // member-less `-keep class`, and Room 2.6's consumer rule is exactly
        // that — so WorkDatabase_Impl.<init>() must be kept explicitly.
        expect(manifest.android?.proguardRules).toContain(
            '-keep class * extends androidx.room.RoomDatabase { <init>(); }',
        );
    });

    it('reaches the generated proguard rules of every app that links it', () => {
        const result = linkAndroid(resolveConfig(CONFIG), [manifest]);
        expect(result.proguardRules).toContain(
            '-keep class * extends androidx.room.RoomDatabase { <init>(); }',
        );
    });
});

describe('#1260 — CSS generic font families on Android', () => {
    const fontsFile = () => join(testDir, 'android', 'app', 'src', 'main', 'kotlin', 'com', 'test', 'fonts', 'SigxGenericFonts.kt');

    it('scaffolds SigxGenericFonts.kt in the app package', () => {
        scaffoldAndroid(testDir, resolveConfig(CONFIG));
        const src = readFileSync(fontsFile(), 'utf-8');
        expect(src).toContain('package com.test.fonts');
        expect(src).toContain('TypefaceCache.addLazyProvider');
        for (const generic of ['"monospace"', '"serif"', '"sans-serif"']) expect(src).toContain(generic);
    });

    it('is a managed file, so apps scaffolded before it existed get it on prebuild', () => {
        const config = resolveConfig(CONFIG);
        scaffoldAndroid(testDir, config);
        rmSync(fontsFile());
        refreshAndroidManagedFiles(testDir, config);
        expect(existsSync(fontsFile())).toBe(true);
    });

    it('is installed from the generated registry (with and without linked modules)', () => {
        const linked = linkAndroid(resolveConfig(CONFIG), []);
        expect(linked.registryCode).toContain('SigxGenericFonts.install()');

        scaffoldAndroid(testDir, resolveConfig(CONFIG));
        const stub = readFileSync(join(dirname(fontsFile()), 'GeneratedModuleRegistry.kt'), 'utf-8');
        expect(stub).toContain('SigxGenericFonts.install()');
    });
});
