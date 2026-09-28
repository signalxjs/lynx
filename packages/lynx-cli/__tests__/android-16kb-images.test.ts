/**
 * Regression tests for #1251 — on 16 KB page-size Android devices every image
 * load crashed, because Fresco 2.3.0's native libraries are not 16 KB aligned.
 * The template now pins a 16 KB-aligned Fresco (>= 3.4.0) and compiles the Lynx
 * image service from vendored sources instead of the `lynx-service-image` AAR
 * (which is binary-incompatible with Fresco 3.x).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
    getTemplatesDir,
    scaffoldAndroid,
    refreshAndroidManagedFiles,
    VENDORED_IMAGE_SERVICE_FILES,
} from '../src/prebuild.js';
import { resolveConfig } from '../src/config/parser.js';
import type { LynxConfig } from '../src/config/schema.js';

const BASE_CONFIG: LynxConfig = {
    name: 'TestApp',
    android: { applicationId: 'com.test.myapp' },
    ios: { bundleIdentifier: 'com.test.myapp' },
};

const templateGradle = () =>
    readFileSync(join(getTemplatesDir(), 'android', 'app', 'build.gradle.kts'), 'utf-8');

/** Every `com.facebook.fresco:<artifact>:<version>` coordinate in the template. */
function frescoCoordinates(gradle: string): Array<{ artifact: string; version: string }> {
    return [...gradle.matchAll(/"com\.facebook\.fresco:([\w-]+):([\d.]+)"/g)].map((m) => ({
        artifact: m[1],
        version: m[2],
    }));
}

function atLeast(version: string, min: [number, number]): boolean {
    const [major, minor] = version.split('.').map(Number);
    return major > min[0] || (major === min[0] && minor >= min[1]);
}

describe('Android template: 16 KB page-size image stack (#1251)', () => {
    it('pins every Fresco artifact to one 16 KB-aligned version (>= 3.4.0)', () => {
        const coords = frescoCoordinates(templateGradle());
        expect(coords.map((c) => c.artifact)).toEqual(
            expect.arrayContaining(['fresco', 'animated-gif', 'animated-webp', 'webpsupport', 'animated-base', 'middleware']),
        );
        const versions = new Set(coords.map((c) => c.version));
        expect(versions.size).toBe(1);
        for (const c of coords) expect(atLeast(c.version, [3, 4]), `${c.artifact}:${c.version}`).toBe(true);
    });

    it('does not depend on the Fresco-2-compiled lynx-service-image artifact', () => {
        const deps = templateGradle()
            .split('\n')
            .filter((l) => /^\s*(implementation|api)\(/.test(l));
        expect(deps.some((l) => l.includes('lynx-service-image'))).toBe(false);
    });

    it('ships the vendored image service sources in the template', () => {
        const template = join(getTemplatesDir(), 'android');
        for (const rel of VENDORED_IMAGE_SERVICE_FILES) {
            const src = readFileSync(join(template, rel), 'utf-8');
            expect(src).toMatch(/^package com\.lynx\.service\.image/m);
            expect(src).toContain('Licensed under the Apache License Version 2.0');
        }
        // Fresco 3.x AnimationListener callbacks take a Drawable, not AnimatedDrawable2.
        const service = readFileSync(
            join(template, 'app/src/main/java/com/lynx/service/image/LynxImageService.java'),
            'utf-8',
        );
        expect(service).not.toMatch(/public void onAnimation\w+\(AnimatedDrawable2 /);
    });

    describe('existing projects', () => {
        let testDir: string;
        beforeEach(() => {
            testDir = join(tmpdir(), `sigx-16kb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
            mkdirSync(testDir, { recursive: true });
        });
        afterEach(() => rmSync(testDir, { recursive: true, force: true }));

        it('refresh adds the vendored sources to a project scaffolded before #1251', () => {
            const config = resolveConfig(BASE_CONFIG);
            scaffoldAndroid(testDir, config);
            const android = join(testDir, 'android');
            // Roll back to the pre-#1251 layout: no vendored sources, AAR + Fresco 2.3.0.
            rmSync(join(android, 'app', 'src', 'main', 'java'), { recursive: true, force: true });
            writeFileSync(
                join(android, 'app', 'build.gradle.kts'),
                'dependencies {\n    implementation("org.lynxsdk.lynx:lynx-service-image:4.0.1")\n' +
                    '    implementation("com.facebook.fresco:fresco:2.3.0")\n}\n',
            );

            refreshAndroidManagedFiles(testDir, config);

            for (const rel of VENDORED_IMAGE_SERVICE_FILES) {
                expect(existsSync(join(android, rel)), rel).toBe(true);
            }
            const gradle = readFileSync(join(android, 'app', 'build.gradle.kts'), 'utf-8');
            expect(gradle).not.toContain('fresco:fresco:2.3.0');
            expect(frescoCoordinates(gradle).every((c) => atLeast(c.version, [3, 4]))).toBe(true);
        });
    });
});
