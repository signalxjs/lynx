/**
 * The raw render path: the simulation writes `transform` straight onto each
 * element from inside the frame worklet, with no bridge traffic at all.
 *
 * The JSX is deliberately flat and unconditional — one `<view>` per disc, a
 * fixed style object, no wrappers. That keeps the subtree snapshot-friendly
 * and makes the per-frame `setStyleProperty` the only thing that changes,
 * which is what the measurement needs it to be.
 */

import { component, type Define } from '@sigx/lynx';

import type { Disc } from '../game/types.js';
import { colorOf } from '../theme.js';
import type { DiscPool } from './disc-pool.js';

export type DiscLayerProps =
    & Define.Prop<'discs', Disc[], true>
    & Define.Prop<'pool', DiscPool, true>;

const DiscLayerRaw = component<DiscLayerProps>(({ props }) => () => (
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
                    transform: `translate(${disc.x - disc.r}px, ${disc.y - disc.r}px)`,
                }}
            />
        ))}
    </>
));

export default DiscLayerRaw;
