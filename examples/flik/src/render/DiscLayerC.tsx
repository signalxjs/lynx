/**
 * Render path **C** — the mapper without the bridge.
 *
 * The same `useAnimatedStyle` `translate` binding as path A, but over a plain
 * `useMainThreadRef<{value}>` instead of a `useSharedValue`.
 *
 * This works because of an asymmetry in the main-thread flush:
 * `flushAnimatedStyleBindings` resolves a binding's value as
 * `refMap[wvid].current?.value` and never consults `bridgedAvWvids` — that set
 * is read only by `flushAvBridgePublishes`. A `MainThreadRef` holding
 * `{ value }` therefore has exactly the shape a style binding needs, while
 * never having been registered with the background bridge. The mapper runs,
 * the transform applies, and nothing is published to the background thread.
 *
 * So C isolates the question the comparison is actually about: how much of
 * path A's cost is the *binding machinery* and how much is the *bridge*. If
 * C sits with B, the publish is the price; if C sits with A, the mapper is.
 *
 * The cast is deliberate and load-bearing — the types don't sanction this, and
 * if it ever stops working the fallback is path B, which needs no bindings at
 * all. Being able to answer the question is worth the cast in an example whose
 * job is measurement.
 */

import {
    component,
    onMounted,
    runOnMainThread,
    useAnimatedStyle,
    useMainThreadRef,
    type MainThreadRef,
    type SharedValue,
} from '@sigx/lynx';

import type { Disc } from '../game/types.js';
import { colorOf } from '../theme.js';
import type { DiscLayerProps } from './DiscLayerRaw.js';

/** The envelope shape a style binding reads: `ref.current.value`. */
type ValueRef = MainThreadRef<{ value: { x: number; y: number } }>;

const DiscLayerC = component<DiscLayerProps>(({ props }) => {
    const count = props.discs.length;
    // Seeded with each disc's CURRENT position — same reason as path A: the
    // binding overwrites the inline transform on its first flush, so a zero
    // start stacks every disc in the corner.
    const values: ValueRef[] = [];
    for (let i = 0; i < count; i++) {
        const d = props.discs[i]!;
        values.push(useMainThreadRef<{ value: { x: number; y: number } }>({
            value: { x: d.x - d.r, y: d.y - d.r },
        }));
    }
    for (let i = 0; i < count; i++) {
        // The cast is the whole trick: same envelope shape, never bridged.
        useAnimatedStyle(props.pool[i]!, values[i] as unknown as SharedValue<unknown>, 'translate');
    }

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

export default DiscLayerC;
