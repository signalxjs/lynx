/**
 * App env (#1244) on the plugin side: `appEnv()` for lynx.config.ts, the
 * `__SIGX_APP_ENV__` define source, and the `.sigx-build.json` build marker
 * `sigx updates:publish` checks. The env arrives from lynx-cli as canonical
 * JSON in `SIGX_LYNX_ENV`.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appEnv, appEnvDefine, buildMarker, writeBuildMarker, BUILD_MARKER_FILE } from '../src/app-env';

const KEYS = ['SIGX_LYNX_ENV', 'SIGX_LYNX_VARIANT', 'SIGX_LYNX_UPDATES_CHANNEL'];
const tempDirs: string[] = [];

afterEach(() => {
    for (const key of KEYS) delete process.env[key];
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('appEnv / __SIGX_APP_ENV__', () => {
    it('parses SIGX_LYNX_ENV and passes canonical JSON through unchanged', () => {
        const json = '{"api":"https://staging.example.com","flags":{"beta":true}}';
        process.env['SIGX_LYNX_ENV'] = json;
        expect(appEnv()).toEqual({ api: 'https://staging.example.com', flags: { beta: true } });
        expect(appEnvDefine()).toBe(json);
    });

    it('falls back to {} when unset, malformed, or not an object', () => {
        expect(appEnv()).toEqual({});
        expect(appEnvDefine()).toBe('{}');
        process.env['SIGX_LYNX_ENV'] = 'alert(1)';
        expect(appEnvDefine()).toBe('{}');
        process.env['SIGX_LYNX_ENV'] = '[1,2]';
        expect(appEnv()).toEqual({});
    });
});

describe('build marker', () => {
    it('records the variant, env hash and channel of the current build env', () => {
        process.env['SIGX_LYNX_ENV'] = '{"api":"x"}';
        process.env['SIGX_LYNX_VARIANT'] = 'staging';
        process.env['SIGX_LYNX_UPDATES_CHANNEL'] = 'staging';
        expect(buildMarker(new Date(0))).toEqual({
            variant: 'staging',
            envHash: createHash('sha256').update('{"api":"x"}').digest('hex'),
            channel: 'staging',
            builtAt: '1970-01-01T00:00:00.000Z',
        });
    });

    it('defaults to the base build on the production channel', () => {
        const marker = buildMarker();
        expect(marker.variant).toBe('');
        expect(marker.channel).toBe('production');
        expect(marker.envHash).toBe(createHash('sha256').update('{}').digest('hex'));
    });

    it('writes the marker once into each distinct output dir', () => {
        const root = mkdtempSync(join(tmpdir(), 'sigx-marker-'));
        tempDirs.push(root);
        const dist = join(root, 'dist');
        writeBuildMarker([dist, join(dist, '.'), join(root, 'other')]);
        for (const dir of [dist, join(root, 'other')]) {
            const marker = JSON.parse(readFileSync(join(dir, BUILD_MARKER_FILE), 'utf-8'));
            expect(marker.variant).toBe('');
        }
    });
});
