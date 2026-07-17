/**
 * `sigx build:web` static export (#714) — host-page option rendering and the
 * export manifest/verify helpers (the fs-heavy assembly is exercised
 * end-to-end against the showcase; here we pin the contracts).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { hostHtml, normalizeBasePath } from '../src/web-server.js';
import { expectedExportManifest, verifyExport } from '../src/web-build.js';

describe('normalizeBasePath', () => {
  it('normalizes to /segment/…/ form', () => {
    expect(normalizeBasePath(undefined)).toBe('/');
    expect(normalizeBasePath('')).toBe('/');
    expect(normalizeBasePath('/')).toBe('/');
    expect(normalizeBasePath('lynx')).toBe('/lynx/');
    expect(normalizeBasePath('/lynx')).toBe('/lynx/');
    expect(normalizeBasePath('lynx/')).toBe('/lynx/');
    expect(normalizeBasePath('/lynx/')).toBe('/lynx/');
  });
});

describe('hostHtml options', () => {
  it('default (dev): reload client on, root base', () => {
    const html = hostHtml('demo', 'main.web.bundle');
    expect(html).toContain('/__sigx_reload');
    expect(html).toContain('src="/engine/static/js/client.js"');
    expect(html).toContain('url="/app/main.web.bundle"');
    expect(html).not.toContain('coi.js');
  });

  it('static export: no reload client, base-prefixed assets, optional coi', () => {
    const html = hostHtml('demo', 'main.web.bundle', {
      reload: false,
      base: 'lynx', // un-normalized on purpose — hostHtml normalizes internally
      coi: true,
    });
    expect(html).not.toContain('/__sigx_reload');
    expect(html).toContain('src="/lynx/engine/static/js/client.js"');
    expect(html).toContain('url="/lynx/app/main.web.bundle"');
    expect(html).toContain('from \'/lynx/host/sigx-host.js\'');
    expect(html).toContain('<script src="/lynx/coi.js"></script>');
  });
});

describe('export manifest', () => {
  it('lists the deployable contract, with coi.js only when enabled', () => {
    const base = expectedExportManifest('main.web.bundle', false);
    expect(base).toContain('index.html');
    expect(base).toContain(join('app', 'main.web.bundle'));
    expect(base).toContain(join('host', 'sigx-host.js'));
    expect(base).toContain(join('engine', 'static', 'js', 'client.js'));
    expect(base).not.toContain('coi.js');
    expect(expectedExportManifest('main.web.bundle', true)).toContain('coi.js');
  });

  it('verifyExport reports exactly the missing files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sigx-web-export-'));
    try {
      for (const rel of expectedExportManifest('main.web.bundle', false)) {
        const abs = join(dir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, 'x');
      }
      expect(verifyExport(dir, 'main.web.bundle', false)).toEqual([]);
      // coi requested but not emitted → exactly that file is missing
      expect(verifyExport(dir, 'main.web.bundle', true)).toEqual(['coi.js']);
      rmSync(join(dir, 'index.html'));
      expect(verifyExport(dir, 'main.web.bundle', false)).toEqual(['index.html']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
