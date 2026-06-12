/**
 * `<UpdateProgress>` — inline progress bar + percent label, visible only
 * while an update is downloading. Renders an out-of-flow zero-size
 * placeholder otherwise (the same closed-state shape as daisyui's Modal —
 * see the lynx display:none caveat there).
 *
 * When the server sent no Content-Length the percent is unknown, so the
 * label falls back to the received byte count.
 */

import { component, type Define } from '@sigx/lynx';
import { Progress, type ProgressColor } from '@sigx/lynx-daisyui';
import { useUpdates } from '@sigx/lynx-updates';
import { downloadPercent, formatBytes } from './format.js';

export type UpdateProgressProps =
    /** Progress bar color (daisy semantic color). */
    & Define.Prop<'color', ProgressColor, false>
    /** Extra class for the row container. */
    & Define.Prop<'class', string, false>;

export const UpdateProgress = component<UpdateProgressProps>(({ props }) => {
    const updates = useUpdates();

    return () => {
        const state = updates.value;
        if (state.status !== 'downloading') {
            return <view style={{ position: 'absolute', width: '0px', height: '0px', opacity: 0 }} />;
        }

        const pct = downloadPercent(state.progress);
        const label = pct != null
            ? `${pct}%`
            : formatBytes(state.progress?.receivedBytes ?? 0);

        return (
            <view
                class={`update-progress${props.class ? ' ' + props.class : ''}`}
                style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' }}
            >
                <view style={{ flexGrow: 1, flexShrink: 1 }}>
                    <Progress value={pct ?? 0} color={props.color} />
                </view>
                <text class="text-sm opacity-70">{label}</text>
            </view>
        );
    };
});
