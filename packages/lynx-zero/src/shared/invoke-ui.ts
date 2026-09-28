/**
 * Call a native element's UI method (`scrollTo`, `focus`, …) from the
 * background thread. `focusNative` (native-text.ts) is the `focus`-only
 * spelling of the same two paths; this is the general one.
 *
 * On the background thread a callback `ref` hands over the runtime's
 * ShadowElement, which has only its numeric `id` — no `invoke` — so the call
 * rides the runtime's fire-and-forget `INVOKE_UI_METHOD` op. A main-thread
 * element (and a test double) carries `invoke` itself and is called
 * directly. A stale or not-yet-native element is a no-op, never an
 * unhandled rejection.
 */
import { OP, pushOp, scheduleFlush } from '@sigx/lynx';
import type { InvokableElement } from './native-text.js';

export function invokeUiMethod(
    el: InvokableElement | null | undefined,
    method: string,
    params: Record<string, unknown> = {},
): void {
    if (!el) return;
    if (typeof el.invoke === 'function') {
        try {
            const result = el.invoke(method, params);
            if (result && typeof (result as Promise<unknown>).catch === 'function') {
                (result as Promise<unknown>).catch(() => {});
            }
        } catch {
            // No native node yet — nothing to call.
        }
        return;
    }
    if (typeof el.id === 'number') {
        pushOp(OP.INVOKE_UI_METHOD, el.id, method, params);
        scheduleFlush();
    }
}
