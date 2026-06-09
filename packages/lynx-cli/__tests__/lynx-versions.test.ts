/**
 * Tests for the `sigx doctor` @sigx/lynx-* version helpers: semver compare,
 * skew assessment, node_modules collection (temp fixture), and the best-effort
 * registry lookup (mocked fetch).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    collectLynxVersions,
    groupByVersion,
    compareSemver,
    assessLynxVersions,
    fetchLatestVersion,
} from '../src/util/lynx-versions.js';

describe('compareSemver', () => {
    it('orders by major/minor/patch', () => {
        expect(compareSemver('0.5.2', '0.5.0')).toBe(1);
        expect(compareSemver('0.5.0', '0.5.2')).toBe(-1);
        expect(compareSemver('0.5.2', '0.5.2')).toBe(0);
        expect(compareSemver('1.0.0', '0.9.9')).toBe(1);
        expect(compareSemver('0.6.0', '0.5.9')).toBe(1);
    });
    it('ignores prerelease/build metadata', () => {
        expect(compareSemver('0.5.2-beta.1', '0.5.2')).toBe(0);
        expect(compareSemver('0.5.2+build', '0.5.2')).toBe(0);
    });
});

describe('assessLynxVersions / groupByVersion', () => {
    it('none when empty', () => {
        expect(assessLynxVersions(new Map())).toEqual({ kind: 'none' });
    });
    it('ok when all aligned', () => {
        const v = new Map([['@sigx/lynx', '0.5.2'], ['@sigx/lynx-http', '0.5.2']]);
        expect(assessLynxVersions(v)).toEqual({ kind: 'ok', version: '0.5.2' });
    });
    it('skew when mixed, groups sorted by count desc', () => {
        const v = new Map([
            ['@sigx/lynx', '0.5.2'],
            ['@sigx/lynx-http', '0.5.0'],
            ['@sigx/lynx-core', '0.5.0'],
        ]);
        const r = assessLynxVersions(v);
        expect(r.kind).toBe('skew');
        if (r.kind === 'skew') {
            expect(r.groups[0]).toEqual({ version: '0.5.0', names: ['@sigx/lynx-http', '@sigx/lynx-core'] });
            expect(r.groups[1]).toEqual({ version: '0.5.2', names: ['@sigx/lynx'] });
        }
        expect(groupByVersion(v).size).toBe(2);
    });
});

describe('collectLynxVersions', () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'sigx-doctor-'));
        const scope = join(dir, 'node_modules', '@sigx');
        const write = (pkgDir: string, json: unknown) => {
            mkdirSync(join(scope, pkgDir), { recursive: true });
            writeFileSync(join(scope, pkgDir, 'package.json'), JSON.stringify(json));
        };
        write('lynx', { version: '0.5.2' });
        write('lynx-http', { version: '0.5.0' });       // skewed
        write('other', { version: '9.9.9' });            // non-lynx — ignored
        mkdirSync(join(scope, 'lynx-bad'), { recursive: true }); // no package.json — skipped
    });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('reads @sigx/lynx-* versions, ignoring non-lynx and unreadable dirs', () => {
        const v = collectLynxVersions(dir);
        expect(v.get('@sigx/lynx')).toBe('0.5.2');
        expect(v.get('@sigx/lynx-http')).toBe('0.5.0');
        expect(v.has('@sigx/other')).toBe(false);
        expect(v.has('@sigx/lynx-bad')).toBe(false);
        expect(assessLynxVersions(v).kind).toBe('skew');
    });

    it('returns empty when no @sigx scope exists', () => {
        const empty = mkdtempSync(join(tmpdir(), 'sigx-empty-'));
        expect(collectLynxVersions(empty).size).toBe(0);
        rmSync(empty, { recursive: true, force: true });
    });
});

describe('fetchLatestVersion', () => {
    afterEach(() => vi.unstubAllGlobals());
    it('returns the version on a 200', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ version: '0.5.2' }) })));
        expect(await fetchLatestVersion('@sigx/lynx')).toBe('0.5.2');
    });
    it('returns undefined on non-ok / network failure', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
        expect(await fetchLatestVersion('@sigx/lynx')).toBeUndefined();
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
        expect(await fetchLatestVersion('@sigx/lynx')).toBeUndefined();
    });
});
