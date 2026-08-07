/**
 * Broadphase: fill the candidate-pair buffer.
 *
 * Split from collision resolution so both strategies share one copy of the
 * pair math, and so the HUD can report candidate pairs against actual
 * contacts — the ratio is what tells you whether the broadphase is earning
 * its keep.
 *
 * All-pairs is `n(n-1)/2` per substep: 66 at the real game's 12 discs (free),
 * 19,900 at 200. The uniform grid at `cell = 2·maxRadius` gives roughly `4n`.
 * Below ~24 discs the grid's rebuild costs more than it saves, which is why
 * `tick.mt.ts` picks by count — and why the toggle stays, since the crossover
 * is itself a thing worth measuring.
 */

import type { SimState } from './state.js';

export function emitPairs(st: SimState): void {
    'main thread';
    const n = st.n;
    const alive = st.alive;
    const pi = st.pi;
    const pj = st.pj;
    const cap = pi.length;
    let np = 0;

    if (st.broadphase === 0) {
        for (let i = 0; i < n; i++) {
            if (alive[i] === 0) continue;
            for (let j = i + 1; j < n; j++) {
                if (alive[j] === 0) continue;
                if (np === cap) {
                    st.np = np;
                    st.tests = np;
                    return;
                }
                pi[np] = i;
                pj[np] = j;
                np++;
            }
        }
        st.np = np;
        st.tests = np;
        return;
    }

    const x = st.x;
    const y = st.y;
    const cs = st.cell;
    const cols = st.cols;
    const rows = st.rows;
    const head = st.head;
    const next = st.next;

    const cellCount = cols * rows;
    for (let c = 0; c < cellCount; c++) head[c] = -1;

    for (let i = 0; i < n; i++) {
        if (alive[i] === 0) continue;
        let cx = Math.floor(x[i]! / cs);
        let cy = Math.floor(y[i]! / cs);
        if (cx < 0) cx = 0;
        else if (cx >= cols) cx = cols - 1;
        if (cy < 0) cy = 0;
        else if (cy >= rows) cy = rows - 1;
        const c = cy * cols + cx;
        next[i] = head[c]!;
        head[c] = i;
    }

    // Own cell, then four FORWARD neighbours (E, SE, S, SW). Walking only
    // forward is what emits each pair exactly once — checking all eight would
    // emit every pair twice and resolve every collision twice.
    for (let cy = 0; cy < rows; cy++) {
        for (let cx = 0; cx < cols; cx++) {
            for (let i = head[cy * cols + cx]!; i !== -1; i = next[i]!) {
                for (let j = next[i]!; j !== -1; j = next[j]!) {
                    if (np === cap) {
                        st.np = np;
                        st.tests = np;
                        return;
                    }
                    pi[np] = i;
                    pj[np] = j;
                    np++;
                }
                for (let k = 0; k < 4; k++) {
                    const nx = cx + (k === 0 ? 1 : k === 1 ? 1 : k === 2 ? 0 : -1);
                    const ny = cy + (k === 0 ? 0 : 1);
                    if (nx < 0 || nx >= cols || ny >= rows) continue;
                    for (let j = head[ny * cols + nx]!; j !== -1; j = next[j]!) {
                        if (np === cap) {
                            st.np = np;
                            st.tests = np;
                            return;
                        }
                        pi[np] = i;
                        pj[np] = j;
                        np++;
                    }
                }
            }
        }
    }

    st.np = np;
    st.tests = np;
}
