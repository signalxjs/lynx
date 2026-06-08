/**
 * Pure-helper tests for `sigx run:web` (`web-server.ts`). The build/serve/watch
 * flow is verified manually in a browser; here we cover the deterministic bits:
 * bundle discovery, MIME mapping, path-traversal safety, and host-page wiring.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findWebBundle, contentType, safeJoin, hostHtml } from '../src/web-server';

function withTempDir(files: string[], fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'sigx-web-'));
  try {
    for (const f of files) writeFileSync(join(dir, f), 'x');
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('findWebBundle', () => {
  it('prefers main.web.bundle over other web bundles', () => {
    withTempDir(['other.web.bundle', 'main.web.bundle', 'main.lynx.bundle'], (dir) => {
      expect(findWebBundle(dir)).toBe('main.web.bundle');
    });
  });

  it('returns the sole .web.bundle when not named main', () => {
    withTempDir(['app.web.bundle', 'main.lynx.bundle'], (dir) => {
      expect(findWebBundle(dir)).toBe('app.web.bundle');
    });
  });

  it('returns null when there is no web bundle', () => {
    withTempDir(['main.lynx.bundle'], (dir) => {
      expect(findWebBundle(dir)).toBeNull();
    });
  });

  it('returns null for a missing directory', () => {
    expect(findWebBundle(join(tmpdir(), 'sigx-nope-zzz-does-not-exist'))).toBeNull();
  });
});

describe('contentType', () => {
  it('maps the served extensions and falls back to octet-stream', () => {
    expect(contentType('a/b/x.wasm')).toBe('application/wasm');
    expect(contentType('client.js')).toContain('text/javascript');
    expect(contentType('client.css')).toContain('text/css');
    expect(contentType('main.web.bundle')).toContain('application/json');
    expect(contentType('weird.xyz')).toBe('application/octet-stream');
  });
});

describe('safeJoin', () => {
  it('joins a relative path under the root', () => {
    const root = join(tmpdir(), 'sigx-root');
    expect(safeJoin(root, 'js/client.js')).toBe(join(root, 'js', 'client.js'));
  });

  it('rejects path traversal that escapes the root', () => {
    const root = join(tmpdir(), 'sigx-root');
    // Forward slashes are separators on every platform CI runs on.
    expect(safeJoin(root, '../etc/passwd')).toBeNull();
  });

  it('rejects a sibling dir that shares the root name as a string prefix', () => {
    // The classic naive-`startsWith` bypass: `sigx-root2` starts with `sigx-root`.
    const root = join(tmpdir(), 'sigx-root');
    expect(safeJoin(root, '../sigx-root2/secret')).toBeNull();
  });
});

describe('hostHtml', () => {
  it('wires the lynx-view to the app bundle, the engine, and the reload channel', () => {
    const html = hostHtml('Demo', 'main.web.bundle');
    expect(html).toContain('url="/app/main.web.bundle"');
    expect(html).toContain('/engine/static/js/client.js');
    expect(html).toContain('/engine/static/css/client.css');
    expect(html).toContain('/__sigx_reload');
    expect(html).toContain('Demo');
  });
});
