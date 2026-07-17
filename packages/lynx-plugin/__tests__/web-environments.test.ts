/**
 * Zero-config web environments (signalxjs/lynx#699).
 *
 * When `sigx run:web` requests a web build (SIGX_WEB_ENV=1), the plugin
 * ensures `environments.lynx` + `environments.web` exist so apps need no
 * `environments` block in lynx.config.ts. The merge must only add missing
 * keys — user-declared environments (and their contents) stay untouched.
 */
import { describe, it, expect } from 'vitest';

import { ensureWebEnvironments } from '../src/index';

type Cfg = { environments?: Record<string, unknown>; other?: string };

/** Minimal stand-in for rsbuild's mergeRsbuildConfig: adds environment keys. */
const merge = (a: Cfg, b: { environments: Record<string, object> }): Cfg => ({
  ...a,
  environments: { ...a.environments, ...b.environments },
});

describe('ensureWebEnvironments', () => {
  it('adds web alongside a defaulted lynx-only config', () => {
    // rspeedy defaults `environments` to `{ lynx: {} }` at config-load time.
    const out = ensureWebEnvironments({ environments: { lynx: {} } }, merge);
    expect(Object.keys(out.environments!)).toEqual(['lynx', 'web']);
  });

  it('adds both when no environments exist at all', () => {
    const out = ensureWebEnvironments({}, merge);
    expect(Object.keys(out.environments!).sort()).toEqual(['lynx', 'web']);
  });

  it('returns a fully-declared config as-is (same reference)', () => {
    const cfg: Cfg = { environments: { lynx: { a: 1 }, web: { b: 2 } } };
    expect(ensureWebEnvironments(cfg, merge)).toBe(cfg);
  });

  it('never overwrites user-declared environment contents', () => {
    const cfg: Cfg = { environments: { lynx: { custom: true } } };
    const out = ensureWebEnvironments(cfg, merge);
    expect(out.environments!['lynx']).toEqual({ custom: true });
    expect(out.environments!['web']).toEqual({});
  });

  it('preserves extra user environments untouched', () => {
    const cfg: Cfg = { environments: { 'web-worker': { x: 1 } } };
    const out = ensureWebEnvironments(cfg, merge);
    expect(out.environments!['web-worker']).toEqual({ x: 1 });
    expect(Object.keys(out.environments!).sort()).toEqual(['lynx', 'web', 'web-worker']);
  });
});
