/**
 * Web implementation — unsupported, and it says so.
 *
 * There is no Lynx engine in a web build, so there is no element tree, no UI
 * owner and no main/background runtime split to attribute memory to. Chromium's
 * non-standard `performance.memory` reports the JS heap and nothing else;
 * mapping it into `totalBytes` would put a number in your dashboard that looks
 * comparable to the native one and isn't. Rejecting is the honest answer, and
 * {@link Memory.isAvailable} lets a caller skip the call entirely.
 */
import { SigxError } from '@sigx/lynx-core';
import { normalizeSnapshot } from './memory.js';
import type { MemoryQueryOptions, MemoryUsageSnapshot } from './memory.js';

export type {
    MemoryCollectionStatus,
    MemoryInstanceUsage,
    MemoryQueryOptions,
    MemoryUsageSnapshot,
} from './memory.js';
export { normalizeSnapshot };

// Typed against the native module so a method added to one and not the other is
// a typecheck failure — the plugin swaps these by extension alias, so the
// mismatch would otherwise only surface at runtime, on web.
export const Memory: typeof import('./memory.js').Memory = {
    query(_options: MemoryQueryOptions = {}): Promise<MemoryUsageSnapshot> {
        return Promise.reject(new SigxError(
            'lynx-observability',
            'unsupported',
            '[@sigx/lynx-observability] queryMemoryUsage failed: not supported on web '
            + '(there is no Lynx engine to attribute memory to)',
        ));
    },

    isAvailable(): boolean {
        return false;
    },
} as const;
