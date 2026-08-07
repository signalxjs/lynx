/**
 * Picks which way disc positions reach the screen.
 *
 * The three paths do the same visible thing by very different means, and the
 * point of the switch is to make the cost difference measurable on one device
 * in one sitting rather than argued about:
 *
 *  - **SV** — a `SharedValue` per disc with a `useAnimatedStyle` binding. The
 *    idiomatic path, and the one that also publishes every write to the
 *    background thread.
 *  - **RAW** — the simulation writes `transform` onto the element itself. No
 *    bindings, no bridge.
 *  - **UNB** — the same binding as SV over an unbridged ref, which isolates
 *    how much of SV's cost is the mapper and how much is the publish.
 *
 * Switching remounts the disc layer, so the previous path's bindings are
 * genuinely unregistered rather than left idling in the flush loop.
 */

import { component, type Define } from '@sigx/lynx';

import { RENDER_RAW, RENDER_SHARED_VALUE, RENDER_UNBRIDGED } from '../sim/state.js';
import { COLORS } from '../theme.js';

export type RenderModeSwitchProps =
    & Define.Prop<'mode', number, true>
    & Define.Prop<'onPick', (mode: number) => void, true>;

const OPTIONS: Array<{ mode: number; label: string }> = [
    { mode: RENDER_SHARED_VALUE, label: 'SV' },
    { mode: RENDER_RAW, label: 'RAW' },
    { mode: RENDER_UNBRIDGED, label: 'UNB' },
];

const RenderModeSwitch = component<RenderModeSwitchProps>(({ props }) => () => (
    <view
        style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            marginTop: '6px',
        }}
    >
        {OPTIONS.map((o) => {
            const active = props.mode === o.mode;
            return (
                <view
                    key={o.label}
                    bindtap={() => props.onPick(o.mode)}
                    style={{
                        paddingTop: '4px',
                        paddingBottom: '4px',
                        paddingLeft: '12px',
                        paddingRight: '12px',
                        marginLeft: '4px',
                        marginRight: '4px',
                        borderRadius: '6px',
                        backgroundColor: active ? COLORS.line : 'transparent',
                    }}
                >
                    <text
                        style={{
                            color: active ? COLORS.text : COLORS.textDim,
                            fontSize: '11px',
                            letterSpacing: '1px',
                        }}
                    >
                        {o.label}
                    </text>
                </view>
            );
        })}
    </view>
));

export default RenderModeSwitch;
