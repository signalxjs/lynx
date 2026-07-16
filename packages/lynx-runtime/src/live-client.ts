/**
 * Declare the Lynx BG runtime a **live client** to sigx core.
 *
 * Core gates the async layer on `isLiveClient()`, whose fallback is
 * `typeof window !== 'undefined'` — i.e. "is this a browser". Lynx's BG thread
 * has no `window`, so without an explicit declaration core reads it as a
 * *server render* and never runs a `useData` fetcher: the cell sets `pending`
 * and stays there forever. Core exposes `declareLiveClient()` for exactly this
 * (its own docs name signalxjs/lynx as a target); non-web platform-identity
 * modules call it once on import.
 *
 * Note the mirror-image rule on the web side: `@sigx/runtime-dom/platform` must
 * NOT declare, because the `sigx` umbrella imports it during SSR too and
 * declaring there would defeat the server guard. Only genuinely windowless
 * clients — Lynx, terminal — declare. Lynx has no server render, so this is
 * unconditionally correct here.
 */
import { declareLiveClient } from '@sigx/runtime-core/internals';

// Side effect: run on import, before any component setup can call `useData`.
// index.ts imports this module for its side effect only.
declareLiveClient();
