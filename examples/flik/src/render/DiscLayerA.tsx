/**
 * Render path **A** — the idiomatic one.
 *
 * One `SharedValue<{x,y}>` per disc, applied by a `useAnimatedStyle`
 * `translate` binding. This is what the documentation points a reader at, and
 * what most app code would reach for, which is exactly why it's the path worth
 * measuring rather than assuming.
 *
 * What it costs that the raw path doesn't: every SharedValue is registered
 * with the background bridge, so each write is diffed, JSON-serialized and
 * dispatched to the background thread on the next flush — per disc, per frame.
 * At the real game's twelve discs that is twelve tuples a frame nobody reads;
 * the stress harness is where it should start to show.
 *
 * The values are handed to the simulation through `st.svs` on mount rather
 * than captured by the frame worklet, so switching render modes swaps the
 * array without disturbing the worklet's own capture — the same arrangement
 * `els` already uses.
 */

import {
    component,
    onMounted,
    runOnMainThread,
    useAnimatedStyle,
    useSharedValue,
    type SharedValue,
} from '@sigx/lynx';

import type { Disc } from '../game/types.js';
import { colorOf } from '../theme.js';
import type { DiscLayerProps } from './DiscLayerRaw.js';

export type { DiscLayerProps };

const DiscLayerA = component<DiscLayerProps>(({ props }) => {
    // One binding per disc actually on the board. Binding the whole 400-slot
    // pool would make every flush walk 400 bindings even in the other render
    // modes, which would poison the very comparison this exists for — so the
    // layer is remounted (keyed on disc count) when the count changes.
    const count = props.discs.length;
    // Seeded with each disc's CURRENT position, not zero. The binding applies
    // on its first flush and overwrites whatever inline transform the JSX set,
    // so a zero-initialised value stacks every disc in the corner until the
    // next shot writes to it.
    const values: Array<SharedValue<{ x: number; y: number }>> = [];
    for (let i = 0; i < count; i++) {
        const d = props.discs[i]!;
        values.push(useSharedValue({ x: d.x - d.r, y: d.y - d.r }));
    }
    for (let i = 0; i < count; i++) {
        useAnimatedStyle(props.pool[i]!, values[i] as SharedValue<unknown>, 'translate');
    }

    // `state` MUST be declared before the worklet that captures it. SWC builds
    // the `_c` capture at the `runOnMainThread(...)` call, so a `const`
    // declared below is still in its temporal dead zone and the capture throws
    // a ReferenceError during setup — which takes the whole board render down
    // with it, silently, leaving an empty felt.
    const state = props.state;
    const bind = runOnMainThread(() => {
        'main thread';
        state.current.svs = values as unknown[];
    });
    onMounted(() => {
        void bind().catch(() => {});
    });

    return () => (
        <>
            {props.discs.map((disc: Disc, slot: number) => (
                <view
                    key={disc.id}
                    class="flik-disc"
                    main-thread:ref={props.pool[slot]}
                    style={{
                        position: 'absolute',
                        left: '0px',
                        top: '0px',
                        width: `${disc.r * 2}px`,
                        height: `${disc.r * 2}px`,
                        borderRadius: `${disc.r}px`,
                        backgroundColor: colorOf(disc.owner),
                        // Seed from the board's own state. The binding only
                        // paints once the simulation writes, so without this
                        // every disc sits at the origin until the next shot.
                        transform: `translate(${disc.x - disc.r}px, ${disc.y - disc.r}px)`,
                    }}
                />
            ))}
        </>
    );
});

export default DiscLayerA;
