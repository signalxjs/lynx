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

const PerfHud = component<PerfHudProps>(({ props }) => () => {
    const s = props.stats;
    const v = verdict(s);

    return (
        <view
            style={{
                marginLeft: '12px',
                marginRight: '12px',
                marginTop: '6px',
                paddingTop: '6px',
                paddingBottom: '6px',
                paddingLeft: '8px',
                paddingRight: '8px',
                borderRadius: '8px',
                backgroundColor: COLORS.felt,
            }}
        >
            {props.isDev ? (
                <text
                    style={{
                        color: '#FFD166',
                        fontSize: '10px',
                        letterSpacing: '1px',
                        marginBottom: '4px',
                    }}
                >
                    DEV BUILD — THESE NUMBERS ARE FICTION
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
                    height: '36px',
                }}
            >
                {props.bars.map((ref: MainThreadRef<MainThread.Element | null>, i: number) => (
                    <view
                        key={i}
                        main-thread:ref={ref}
                        style={{
                            width: '3px',
                            marginRight: '1px',
                            height: '1px',
                            borderRadius: '1px',
                            backgroundColor: COLORS.b,
                            opacity: '0.45',
                        }}
                    />
                ))}
            </view>

            <text style={{ color: COLORS.text, fontSize: '11px', marginTop: '4px' }}>
                {summarize(s)}
            </text>
            <text style={{ color: COLORS.textDim, fontSize: '10px' }}>
                {`${props.discCount} discs · peak ${s.writes} writes/${s.contacts} contacts`
                    + ` · ${s.dropped} dropped — ${VERDICT_TEXT[v] ?? v}`}
            </text>
        </view>
    );
});

export default PerfHud;
