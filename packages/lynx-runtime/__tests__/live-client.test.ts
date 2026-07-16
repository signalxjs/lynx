/**
 * The BG runtime must declare itself a live client to sigx core. Core gates
 * `useData`/`useAction` fetchers on `isLiveClient()`, whose fallback is
 * `typeof window !== 'undefined'` — false on Lynx's BG thread. Without the
 * declaration core reads Lynx as a server render and NEVER runs a fetcher:
 * the cell sets 'pending' and stays there forever, silently. See
 * live-client.ts and signalxjs/lynx#647.
 *
 * These tests reset the module graph so core's module-level declaration state
 * is fresh each time — otherwise the assertion passes vacuously, since any
 * other test importing `../src/index` runs `declareLiveClient()` as a side
 * effect and leaves `isLiveClient()` already true. `isLiveClient` is imported
 * dynamically *after* the reset for the same reason (a top-level import binds
 * to a stale core instance that `vi.resetModules()` won't refresh).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('live-client declaration', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a windowless runtime is not a live client by default', async () => {
    // Premise guard: with no `window` and no declaration, core's fallback is
    // false. If this ever failed, the transition test below would pass
    // vacuously (already true before we imported anything).
    expect(typeof globalThis.window).toBe('undefined');
    const { isLiveClient } = await import('@sigx/runtime-core/internals');
    expect(isLiveClient()).toBe(false);
  });

  it('importing live-client flips isLiveClient() false -> true', async () => {
    // Same fresh core instance for the read and the declaration (both resolve
    // through the module cache populated after this test's reset).
    const { isLiveClient } = await import('@sigx/runtime-core/internals');
    expect(isLiveClient()).toBe(false);
    await import('../src/live-client.js');
    expect(isLiveClient()).toBe(true);
  });
});
