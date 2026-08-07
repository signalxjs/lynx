/**
 * Render phase: push positions onto elements.
 *
 * This is the function the whole performance exercise is about. Three paths
 * exist so they can be measured against each other; only the raw one is wired
 * up in this PR.
 *
 *  - `RENDER_RAW` — `el.setStyleProperty('transform', …)` straight from the
 *    tick. No background traffic at all. `setStyleProperty` is
 *    microtask-debounced upstream, so N writes cost one native flush.
 *  - `RENDER_SHARED_VALUE` — a `SharedValue<{x,y}>` per disc, applied by a
 *    `useAnimatedStyle` binding. Every write also publishes to the background
 *    thread, which is the suspected cost.
 *  - `RENDER_UNBRIDGED` — the same binding, but over a plain `MainThreadRef`
 *    that was never registered with the bridge, so the mapper runs without the
 *    publish.
 *
 * The render-mode branch is hoisted OUT of the per-disc loop on purpose: a
 * branch inside would be re-evaluated 400 times a frame to reach the same
 * answer every time.
 */

import type { SimState } from './state.js';

export function writeDiscs(st: SimState): void {
    'main thread';
    const n = st.n;
    const x = st.x;
    const y = st.y;
    const r = st.r;
    const lx = st.lx;
    const ly = st.ly;
    const alive = st.alive;
    const els = st.els as Array<{ current?: {
        setStyleProperty?: (name: string, value: string) => void;
    } | null }> | null;
    const writeEverything = st.writeAll === 1;
    const sub = st.subpixel === 1;
    let writes = 0;

    if (!els) return;

    if (st.renderMode === 1) {
        for (let i = 0; i < n; i++) {
            if (alive[i] === 0) continue;
            const px = x[i]! - r[i]!;
            const py = y[i]! - r[i]!;
            // Dirty-write cull: skip anything that moved less than a quarter
            // pixel since its last write. A settling board is mostly still,
            // and a style write is the expensive part of the frame.
            if (!writeEverything) {
                const ddx = px - lx[i]!;
                const ddy = py - ly[i]!;
                if (ddx * ddx + ddy * ddy < 0.0625) continue;
            }
            lx[i] = px;
            ly[i] = py;

            const el = els[i];
            const handle = el && el.current;
            if (!handle || !handle.setStyleProperty) continue;

            const a = sub ? Math.round(px * 10) / 10 : Math.round(px);
            const b = sub ? Math.round(py * 10) / 10 : Math.round(py);
            handle.setStyleProperty('transform', 'translate(' + a + 'px,' + b + 'px)');
            writes++;
        }
        st.writes = writes;
        return;
    }

    // Both SharedValue paths write the same envelope shape; what differs is
    // whether that envelope was registered with the background bridge.
    const svs = st.svs as Array<{ current?: { value?: unknown } | null }> | null;
    if (!svs) return;
    for (let i = 0; i < n; i++) {
        if (alive[i] === 0) continue;
        const px = x[i]! - r[i]!;
        const py = y[i]! - r[i]!;
        if (!writeEverything) {
            const ddx = px - lx[i]!;
            const ddy = py - ly[i]!;
            if (ddx * ddx + ddy * ddy < 0.0625) continue;
        }
        lx[i] = px;
        ly[i] = py;

        const sv = svs[i];
        const env = sv && sv.current;
        if (!env) continue;
        // MUST be a fresh object. The style-binding flush skips a binding
        // whose value is `===` its last one, and the `translate` mapper takes
        // an object — so mutating in place would freeze every disc, silently.
        env.value = { x: px, y: py };
        writes++;
    }
    st.writes = writes;
}
