/**
 * Storage-backed "don't ask again" suppression for update prompts.
 *
 * `<UpdatePrompt>` records a dismissal per update id so the same update is
 * never re-offered after the user taps "Later". Persistence goes through
 * `@sigx/lynx-storage`; when the native Storage module is unavailable (web
 * preview, tests) it degrades gracefully to an in-process Set, so dismissals
 * still suppress re-prompts for the lifetime of the JS context.
 */

import { Storage } from '@sigx/lynx-storage';

/** Storage key prefix — full key is `__sigx_updates_dismissed:<update id>`. */
export const DISMISSED_KEY_PREFIX = '__sigx_updates_dismissed:';

/** In-memory fallback (and fast path) when native Storage is absent. */
const memory = new Set<string>();

/** True when the user has dismissed the update with this id before. */
export async function isDismissed(id: string): Promise<boolean> {
    if (!id) return false;
    if (memory.has(id)) return true;
    if (!Storage.isAvailable()) return false;
    try {
        return (await Storage.getItem(DISMISSED_KEY_PREFIX + id)) != null;
    } catch {
        return false;
    }
}

/** Record that the update with this id was dismissed ("Later"). */
export async function dismiss(id: string): Promise<void> {
    if (!id) return;
    memory.add(id);
    if (!Storage.isAvailable()) return;
    try {
        Storage.setItem(DISMISSED_KEY_PREFIX + id, new Date().toISOString());
    } catch {
        // Native write failed — the in-memory record still suppresses
        // re-prompts for this session.
    }
}
