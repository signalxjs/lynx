/**
 * The BG runtime must declare itself a live client to sigx core. Core gates
 * `useData`/`useAction` fetchers on `isLiveClient()`, whose fallback is
 * `typeof window !== 'undefined'` — false on Lynx's BG thread. Without the
 * declaration core reads Lynx as a server render and NEVER runs a fetcher:
 * the cell sets 'pending' and stays there forever, silently. See
 * live-client.ts and signalxjs/lynx#647.
 */
import { describe, it, expect } from 'vitest';
import { isLiveClient } from '@sigx/runtime-core/internals';

describe('live-client declaration', () => {
  it('is not a live client by default in a windowless runtime', () => {
    // Guards the test's own premise: with no `window` and no declaration,
    // core's fallback says "server". If this ever fails, the assertion below
    // would pass vacuously and stop protecting anything.
    expect(typeof globalThis.window).toBe('undefined');
  });

  it('declares the runtime a live client on import', async () => {
    await import('../src/live-client.js');
    expect(isLiveClient()).toBe(true);
  });
});
