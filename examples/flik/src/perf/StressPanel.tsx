/**
 * The stress harness controls.
 *
 * Everything here exists to isolate one variable at a time, because a single
 * "it's slow at 400 discs" number tells you nothing about *which* part is
 * slow. Each toggle removes one candidate:
 *
 *  - **N** — the scaling curve itself.
 *  - **grid** — picks the broadphase. Lit means the uniform grid; unlit
 *    means all-pairs, which is O(n²). If turning it off barely moves the
 *    curve, the physics isn't what you're measuring and the render path is.
 *  - **all** — defeats the dirty-write cull so every disc is written every
 *    frame. The gap between this and normal is how much the cull is saving.
 *  - **loop** — re-kicks at quiescence instead of settling, so the board stays
 *    permanently agitated. A decaying transient gives a number that depends on
 *    when you happened to read it; this gives a stable one.
 */

import { component, type Define } from '@sigx/lynx';

import { COLORS } from '../theme.js';

export type StressPanelProps =
    & Define.Prop<'count', number, true>
    & Define.Prop<'broadphase', number, true>
    & Define.Prop<'writeAll', number, true>
    & Define.Prop<'stressLoop', number, true>
    & Define.Prop<'onCount', (n: number) => void, true>
    & Define.Prop<'onToggle', (knob: string, value: number) => void, true>;

/** Disc counts worth sampling. 12 is the real game; 400 is the pool ceiling. */
const COUNTS = [12, 50, 100, 200, 400];

const Chip = component<
    & Define.Prop<'label', string, true>
    & Define.Prop<'active', boolean, true>
    & Define.Prop<'onPick', () => void, true>
>(({ props }) => () => (
    <view
        bindtap={() => props.onPick()}
        style={{
            paddingTop: '3px',
            paddingBottom: '3px',
            paddingLeft: '8px',
            paddingRight: '8px',
            marginLeft: '2px',
            marginRight: '2px',
            borderRadius: '5px',
            backgroundColor: props.active ? COLORS.line : 'transparent',
        }}
    >
        <text
            style={{
                color: props.active ? COLORS.text : COLORS.textDim,
                fontSize: '10px',
            }}
        >
            {props.label}
        </text>
    </view>
));

const StressPanel = component<StressPanelProps>(({ props }) => () => (
    <view style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}>
            {COUNTS.map((n) => (
                <Chip
                    key={n}
                    label={String(n)}
                    active={props.count === n}
                    onPick={() => props.onCount(n)}
                />
            ))}
        </view>
        <view
            style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: '3px',
            }}
        >
            <Chip
                label="grid"
                active={props.broadphase === 1}
                onPick={() => props.onToggle('broadphase', props.broadphase === 1 ? 0 : 1)}
            />
            <Chip
                label="all"
                active={props.writeAll === 1}
                onPick={() => props.onToggle('writeAll', props.writeAll === 1 ? 0 : 1)}
            />
            <Chip
                label="loop"
                active={props.stressLoop === 1}
                onPick={() => props.onToggle('stressLoop', props.stressLoop === 1 ? 0 : 1)}
            />
        </view>
    </view>
));

export default StressPanel;
