/**
 * The performance readout: a live sparkline and a numeric panel.
 *
 * The two halves are deliberately fed by different channels, so the HUD's own
 * cost is measurable by switching one off:
 *
 *  - **Sparkline** — one bar per frame, written straight onto the element from
 *    the frame worklet. One style write per frame, no matter how many discs
 *    are moving, and no background traffic at all. This is the readout to
 *    trust while measuring.
 *  - **Numbers** — drained to the background thread twice a second and
 *    rendered normally. Richer, but it crosses the bridge, so it is the half
 *    that could in principle distort what it reports.
 */

import { component, type Define, type MainThread, type MainThreadRef } from '@sigx/lynx';

import { COLORS } from '../theme.js';
import { summarize, verdict, type FrameStats } from './stats.js';
import type { SparkBars } from './spark-bars.js';

export type PerfHudProps =
    & Define.Prop<'stats', FrameStats, true>
    & Define.Prop<'bars', SparkBars, true>
    /** True in a development build, where the numbers are not real. */
    & Define.Prop<'isDev', boolean, true>
    & Define.Prop<'discCount', number, true>;

const VERDICT_TEXT: Record<string, string> = {
    idle: 'idle',
    fine: 'on time',
    ours: 'our tick is the bottleneck',
    native: 'time is going outside our tick',
};

/**
 * Compact enough to live in the header's centre column, between the two
 * scores, where the wordmark used to be — the row exists either way, so the
 * instrumentation costs the board no height at all.
 */
const PerfHud = component<PerfHudProps>(({ props }) => () => {
    const s = props.stats;
    const v = verdict(s);

    return (
        <view style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {props.isDev ? (
                <text
                    style={{
                        color: '#FFD166',
                        fontSize: '9px',
                        letterSpacing: '1px',
                        marginBottom: '2px',
                    }}
                >
                    DEV BUILD — NOT REAL NUMBERS
                </text>
            ) : null}

            {/*
              * Fixed-height track with bars pinned to the bottom. Each bar's
              * height is rewritten by the frame worklet; nothing here
              * re-renders while the simulation runs.
              */}
            <view
                style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'flex-end',
                    height: '26px',
                }}
            >
                {props.bars.map((ref: MainThreadRef<MainThread.Element | null>, i: number) => (
                    <view
                        key={i}
                        main-thread:ref={ref}
                        style={{
                            width: '2px',
                            marginRight: '1px',
                            height: '1px',
                            borderRadius: '1px',
                            backgroundColor: COLORS.b,
                            opacity: '0.45',
                        }}
                    />
                ))}
            </view>

            <text style={{ color: COLORS.text, fontSize: '10px', marginTop: '3px' }}>
                {summarize(s)}
            </text>
            <text style={{ color: COLORS.textDim, fontSize: '9px' }}>
                {`${props.discCount} discs · ${s.writes}w/${s.contacts}c`
                    + ` · ${s.dropped} drop — ${VERDICT_TEXT[v] ?? v}`}
            </text>
        </view>
    );
});

export default PerfHud;
