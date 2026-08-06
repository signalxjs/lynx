/**
 * The frame loop — the one place in FLIK that talks across threads while a
 * shot is in flight, and it does so exactly once per shot.
 *
 * ```
 * BG --runOnMainThread(seedWorld)---------> MT   turn setup
 * MT --(gesture -> launch, entirely MT)---> MT   no round trip
 * MT --[simulating: ZERO background traffic]
 * MT --runOnBackground(onSettle)----------> BG   ONCE, at quiescence
 * BG --[rules: steal / reload / burn / turn]
 * ```
 *
 * A ~1.5s shot is about 90 frames and sends the background thread a single
 * message. That is the number the render-path comparison is measured against.
 */

import {
    onMounted,
    runOnBackground,
    runOnMainThread,
    startFrameCallback,
    useFrameCallback,
    useMainThreadRef,
    type MainThreadRef,
} from '@sigx/lynx';

import { stepWorld } from './sim/tick.mt.js';
import { writeDiscs } from './sim/write.mt.js';
import { applyWorld, kickAll, launch } from './sim/world.mt.js';
import { createSimState, type SimState } from './sim/state.js';
import { POOL_SIZE, type DiscPool } from './render/disc-pool.js';

/** Upper bound on discs, so every array is allocated once and never grows. */
export const MAX_DISCS = POOL_SIZE;

export interface SimLoop {
    /** The world. Capture it in a worklet; never read `.current` on BG. */
    state: MainThreadRef<SimState>;
    /** Hand the simulation a fresh board (packed by `packWorld`). */
    seed: (packed: number[], width: number, height: number, seq: number) => void;
    /** Fire a disc and start the loop. */
    fire: (discId: number, vx: number, vy: number, seq: number) => void;
    /** Fling everything — the stress agitator. */
    kick: (speed: number) => void;
    /** Push a knob (`renderMode`, `writeAll`, …) into the world. */
    setKnob: (name: string, value: number) => void;
}

export interface SimLoopOptions {
    /** Element refs, index-aligned with the simulation's slots. */
    pool: DiscPool;
    /** Called once per shot, on the background thread, with `[id, x, y, …]`. */
    onSettle: (seq: number, packed: number[], bigHit: number) => void;
}

export function useSimLoop(options: SimLoopOptions): SimLoop {
    const state = useMainThreadRef<SimState>(createSimState(MAX_DISCS));
    const { pool } = options;

    // Park the loop the moment the board settles, then hand the result on.
    // Without this the frame callback keeps ticking forever over an idle
    // board — cheap per frame, but sixty times a second for the life of the
    // app.
    const onSettle = (seq: number, packed: number[], bigHit: number): void => {
        loop.stop();
        options.onSettle(seq, packed, bigHit);
    };

    // Hand the pool to the simulation on the main thread. It has to happen
    // there and after mount: each ref's `.current` is the init snapshot on the
    // background thread, and the elements don't exist until the discs render.
    const bindElements = runOnMainThread(() => {
        'main thread';
        state.current.els = pool as unknown[];
    });
    onMounted(() => {
        void bindElements().catch(() => {});
    });

    // Not `autostart`: an idle board should cost nothing. The loop is started
    // on the main thread by `fire`/`kick` (so a launch begins simulating in
    // the frame the finger lifts) and stopped from `onSettle` on the
    // background thread.
    //
    // Stopping from BG rather than inside the frame worklet is deliberate.
    // `stopFrameCallback(loop)` in the body would need `loop` captured into
    // its own `_c`, and the capture is built while `loop` is still in its
    // temporal dead zone — it would arrive as `undefined`. Stopping from the
    // settle handler costs one round trip ONCE per shot, not per frame.
    const loop = useFrameCallback((frame) => {
        'main thread';
        const st = state.current;
        if (!st || !st.els) return;

        // Clamp the delta: a resumed app or a paused debugger hands back a
        // gap of seconds, and integrating that in one go teleports every disc
        // through the walls.
        let dt = frame.timeSincePreviousFrame / 1000;
        if (dt > 0.25) dt = 0.25;

        const settled = stepWorld(st, dt);
        writeDiscs(st);

        if (settled === 1) {
            if (st.stressLoop === 1) {
                // Never actually settle: re-agitate so the worst case is
                // sustained rather than a decaying transient. A stable number
                // is the point.
                kickAll(st, 1400);
            } else {
                runOnBackground(onSettle)(st.seq, st.packed, st.bigHit);
            }
        }
    });

    const seedWorld = runOnMainThread(
        (packed: number[], width: number, height: number, seq: number) => {
            'main thread';
            applyWorld(state.current, packed, width, height, seq);
            writeDiscs(state.current);
        },
    );

    const fireDisc = runOnMainThread((discId: number, vx: number, vy: number, seq: number) => {
        'main thread';
        launch(state.current, discId, vx, vy, seq);
        startFrameCallback(loop);
    });

    const kickAllDiscs = runOnMainThread((speed: number) => {
        'main thread';
        kickAll(state.current, speed);
        startFrameCallback(loop);
    });

    const writeKnob = runOnMainThread((name: string, value: number) => {
        'main thread';
        (state.current as unknown as Record<string, number>)[name] = value;
    });

    // The dispatches reject on hosts without the worklet transform (tests,
    // plain node) — swallow so callers never have to guard.
    return {
        state,
        seed: (packed, width, height, seq) => {
            void seedWorld(packed, width, height, seq).catch(() => {});
        },
        fire: (discId, vx, vy, seq) => {
            void fireDisc(discId, vx, vy, seq).catch(() => {});
        },
        kick: (speed) => {
            void kickAllDiscs(speed).catch(() => {});
        },
        setKnob: (name, value) => {
            void writeKnob(name, value).catch(() => {});
        },
    };
}
