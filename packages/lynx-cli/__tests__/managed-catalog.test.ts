/**
 * Regression tests for #334 — the Android version catalog must stay in lockstep
 * with the managed `build.gradle.kts` (which references its aliases), and
 * `--clean` does a full native re-scaffold.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
    scaffoldAndroid,
    scaffoldIos,
    refreshAndroidManagedFiles,
    cleanPrebuild,
} from '../src/prebuild.js';
import { resolveConfig } from '../src/config/parser.js';
import type { LynxConfig } from '../src/config/schema.js';
import { GRADLE_WRAPPER_VERSION } from '../src/util/jdk.js';

const BASE_CONFIG: LynxConfig = {
    name: 'TestApp',
    android: { applicationId: 'com.test.myapp' },
    ios: { bundleIdentifier: 'com.test.myapp' },
};

let testDir: string;

beforeEach(() => {
    testDir = join(tmpdir(), `sigx-catalog-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
});

const catalogPath = () => join(testDir, 'android', 'gradle', 'libs.versions.toml');
const gradlePath = () => join(testDir, 'android', 'app', 'build.gradle.kts');

describe('libs.versions.toml is a managed file (catalog tracks build.gradle.kts)', () => {
    it('refresh re-adds an alias dropped from a stale catalog', () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldAndroid(testDir, config);

        // build.gradle.kts (managed) references the fragment-ktx alias…
        expect(readFileSync(gradlePath(), 'utf-8')).toContain('libs.androidx.fragment.ktx');
        // …and a fresh scaffold's catalog defines it.
        expect(readFileSync(catalogPath(), 'utf-8')).toContain('androidx-fragment-ktx');

        // Simulate a pre-#276 stale catalog: strip every `fragment` line.
        const stale = readFileSync(catalogPath(), 'utf-8')
            .split('\n')
            .filter((l) => !l.toLowerCase().includes('fragment'))
            .join('\n');
        writeFileSync(catalogPath(), stale);
        expect(readFileSync(catalogPath(), 'utf-8')).not.toContain('fragment');

        // Refreshing managed files self-heals the catalog (the bug: before the
        // fix it was scaffold-once, so this drift stayed → Unresolved reference).
        refreshAndroidManagedFiles(testDir, config);
        expect(readFileSync(catalogPath(), 'utf-8')).toContain('androidx-fragment-ktx');
    });
});

describe('toolchain files are managed (#1149: Gradle / AGP / Kotlin move together)', () => {
    it('refresh upgrades a project scaffolded with the Gradle 8 / AGP 8 template', () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldAndroid(testDir, config);
        const android = join(testDir, 'android');
        const wrapperProps = join(android, 'gradle', 'wrapper', 'gradle-wrapper.properties');
        const wrapperJar = join(android, 'gradle', 'wrapper', 'gradle-wrapper.jar');
        const rootBuild = join(android, 'build.gradle.kts');
        const templateJar = readFileSync(wrapperJar);

        // Roll the project back to what the pre-#1149 template scaffolded.
        writeFileSync(wrapperProps, 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11.1-bin.zip\n');
        writeFileSync(wrapperJar, Buffer.from('old wrapper jar'));
        writeFileSync(rootBuild, 'plugins {\n    alias(libs.plugins.kotlin.android) apply false\n}\n');

        refreshAndroidManagedFiles(testDir, config);

        expect(readFileSync(wrapperProps, 'utf-8')).toContain(`gradle-${GRADLE_WRAPPER_VERSION}-bin.zip`);
        expect(readFileSync(wrapperJar).equals(templateJar)).toBe(true);
        expect(readFileSync(rootBuild, 'utf-8')).toContain('libs.plugins.legacy.kapt');
        // The app module uses built-in Kotlin: no kotlin-android, AGP's kapt.
        const app = readFileSync(gradlePath(), 'utf-8');
        expect(app).not.toMatch(/^\s*alias\(libs\.plugins\.kotlin\.android\)/m);
        expect(app).not.toContain('kotlinOptions');
        expect(app).toContain('alias(libs.plugins.legacy.kapt)');
    });
});

describe('cleanPrebuild(full) — what `prebuild --clean` now triggers', () => {
    it('removes the android/ and ios/ projects for a full re-scaffold', () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldAndroid(testDir, config);
        scaffoldIos(testDir, config);
        expect(existsSync(join(testDir, 'android'))).toBe(true);
        expect(existsSync(join(testDir, 'ios'))).toBe(true);

        cleanPrebuild(testDir, config, true);

        expect(existsSync(join(testDir, 'android'))).toBe(false);
        expect(existsSync(join(testDir, 'ios'))).toBe(false);
    });

    it('scopes the clean to the selected platform — leaves the other intact', () => {
        const config = resolveConfig(BASE_CONFIG);
        scaffoldAndroid(testDir, config);
        scaffoldIos(testDir, config);

        cleanPrebuild(testDir, config, true, { android: true, ios: false });

        expect(existsSync(join(testDir, 'android'))).toBe(false);
        expect(existsSync(join(testDir, 'ios'))).toBe(true);
    });
});
