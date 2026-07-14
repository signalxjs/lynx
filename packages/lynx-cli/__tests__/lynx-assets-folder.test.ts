/**
 * `ensureIosLynxAssetsFolder` guarantees release builds can carry async chunks
 * (#599): the `LynxAssets/` directory always exists (a referenced-but-missing
 * folder fails xcodebuild) and the pbxproj carries a blue folder reference in
 * the Resources phase (scaffolded projects get it from the template; legacy
 * projects get it injected, idempotently).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scaffoldIos, ensureIosLynxAssetsFolder } from '../src/prebuild.js';
import { resolveConfig } from '../src/config/parser.js';
import type { LynxConfig } from '../src/config/schema.js';

const TEST_CONFIG: LynxConfig = {
    name: 'TestApp',
    version: '1.0.0',
    modules: [],
    platforms: ['ios'],
    android: { applicationId: 'com.test.myapp' },
    ios: { bundleIdentifier: 'com.test.myapp' },
};

const config = resolveConfig(TEST_CONFIG);
let testDir: string;

beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'sigx-lynxassets-'));
    scaffoldIos(testDir, config);
});

afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
});

const pbxprojPath = () => join(testDir, 'ios', 'TestApp.xcodeproj', 'project.pbxproj');
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe('ensureIosLynxAssetsFolder', () => {
    it('creates the LynxAssets directory', () => {
        ensureIosLynxAssetsFolder(testDir, config);
        expect(existsSync(join(testDir, 'ios', 'TestApp', 'LynxAssets'))).toBe(true);
    });

    it('scaffolded template already seeds the folder reference (injector no-ops)', () => {
        const before = readFileSync(pbxprojPath(), 'utf-8');
        expect(count(before, '/* LynxAssets in Resources */')).toBe(2); // BuildFile def + Resources phase
        ensureIosLynxAssetsFolder(testDir, config);
        expect(readFileSync(pbxprojPath(), 'utf-8')).toBe(before);
    });

    it('injects the folder reference into a legacy pbxproj, idempotently', () => {
        // Simulate a project scaffolded before LynxAssets existed.
        const legacy = readFileSync(pbxprojPath(), 'utf-8')
            .split('\n')
            .filter((line) => !line.includes('LynxAssets'))
            .join('\n');
        writeFileSync(pbxprojPath(), legacy);

        ensureIosLynxAssetsFolder(testDir, config);
        const injected = readFileSync(pbxprojPath(), 'utf-8');
        // PBXBuildFile entry + Resources phase entry.
        expect(count(injected, '/* LynxAssets in Resources */')).toBe(2);
        // PBXFileReference is a blue folder reference.
        expect(injected).toMatch(/lastKnownFileType = folder; path = LynxAssets/);
        // Registered in the app's main group.
        expect(injected).toMatch(/\/\* LynxAssets \*\/,/);
        // Landed inside the Resources build phase, not Sources.
        const resourcesPhase = injected.slice(injected.indexOf('PBXResourcesBuildPhase'));
        expect(resourcesPhase).toContain('/* LynxAssets in Resources */,');

        ensureIosLynxAssetsFolder(testDir, config);
        expect(readFileSync(pbxprojPath(), 'utf-8')).toBe(injected);
    });
});
