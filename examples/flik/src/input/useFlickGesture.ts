/**
 * The input gesture: grab one of your discs, slide it around your own end of
 * the board, and flick it.
 *
 * Everything that matters happens on the main thread. `onEnd` has the release
 * velocity in hand, writes it into the disc and starts the frame loop in the
 * same frame the finger lifts — the background thread is told afterwards, and
 * only so the ruleset can record whose shot it was.
 *
 * Every callback ends by flushing the element tree by hand. Nothing here
 * writes a bridged SharedValue, so nothing schedules a flush on our behalf,
 * and the lookup is inlined because a plain imported function does not survive
 * worklet capture.
 */

import {
    Gesture,
    runOnBackground,
    startFrameCallback,
    useGestureDetector,
    type FrameCallback,
    type MainThread,
    type MainThreadRef,
} from '@sigx/lynx';

import { dragBegin, dragCancel, dragMove, dragRelease } from '../sim/drag.mt.js';
import { writeDiscs } from '../sim/write.mt.js';
import { launch } from '../sim/world.mt.js';
import type { SimState } from '../sim/state.js';

export interface FlickGestureOptions {
    /** The board element the gesture is attached to. */
    boardRef: MainThreadRef<MainThread.Element | null>;
    state: MainThreadRef<SimState>;
    /**
     * The frame loop's handle, armed from inside `onEnd` so the simulation
     * begins in the frame the finger lifts.
     *
     * It has to be the handle rather than a callback: a background-thread
     * function captured into a worklet arrives as `undefined` and throws when
     * called, whereas a `FrameCallback` crosses as `{_fcid}` and
     * `startFrameCallback` resolves it on the other side.
     */
    loop: FrameCallback;
    /**
     * A shot was fired, on the background thread. The simulation is already
     * running by the time this lands — it exists so the ruleset can mark which
     * disc was launched (which is what tells a reload from a disc that sat the
     * shot out) and bump the sequence.
     */
    onShot: (discId: number, seq: number) => void;
    /** A disc was repositioned without being thrown, so the board moved. */
    onPlace: (discId: number, x: number, y: number) => void;
}

export function useFlickGesture(options: FlickGestureOptions): void {
    const { boardRef, state, loop, onShot, onPlace } = options;

    const pan = Gesture.Pan()
        // Zero, because the disc should start following on the first pixel.
        // Whether a release counts as a shot is decided by the flick speed,
        // not by how far the finger travelled.
        .minDistance(0)
        // Empty onBegin is load-bearing on iOS: LynxPanGestureHandler bails
        // out of onStart/onEnd unless `_isInvokedBegin` is YES, and that flag
        // is only set inside the native onBegin handler — which itself
        // short-circuits when no callback is registered. Registering any
        // onBegin (even a no-op) gates the begin path open.
        .onBegin(() => {
            'main thread';
        })
        .onStart((e: unknown) => {
            'main thread';
            // Pan payload nests the coordinates: the top level carries only
            // dispatch metadata, and there is no translation or velocity on
            // the native event — which is why the flick speed is derived from
            // page coordinates and `Date.now()` here.
            const ev = e as { params?: { pageX?: number; pageY?: number } };
            const p = ev && ev.params;
            dragBegin(state.current, (p && p.pageX) || 0, (p && p.pageY) || 0, Date.now());
        })
        .onUpdate((e: unknown) => {
            'main thread';
            const ev = e as { params?: { pageX?: number; pageY?: number } };
            const p = ev && ev.params;
            const st = state.current;
            dragMove(st, (p && p.pageX) || 0, (p && p.pageY) || 0, Date.now());
            writeDiscs(st);
            const flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as
                | (() => void)
                | undefined;
            if (flush) flush();
        })
        .onEnd(() => {
            'main thread';
            const st = state.current;
            const slot = st.dragSlot;
            const shot = dragRelease(st);

            if (shot) {
                const seq = st.seq + 1;
                launch(st, shot[0]!, shot[1]!, shot[2]!, seq);
                startFrameCallback(loop);
                runOnBackground(onShot)(shot[0]!, seq);
                return;
            }

            // Placed, not thrown. The board still moved, so the background
            // thread's copy has to learn about it or the next seed would drag
            // the disc back to where it was.
            if (slot >= 0) {
                writeDiscs(st);
                const flush = (globalThis as Record<string, unknown>)['__FlushElementTree'] as
                    | (() => void)
                    | undefined;
                if (flush) flush();
                runOnBackground(onPlace)(st.id[slot]!, st.x[slot]!, st.y[slot]!);
            }
        })
        .onFinalize(() => {
            'main thread';
            dragCancel(state.current);
        });

    useGestureDetector(boardRef, pan);
}
