/**
 * The board: zone bands, edge, and the discs at rest.
 *
 * Static in this PR — nothing here moves yet. The simulation (PR 2) drives the
 * same disc elements through main-thread refs, so the JSX deliberately stays
 * trivially simple: each disc is one `<view>` with a fixed style object and no
 * conditional structure, which is what keeps the subtree snapshot-friendly and
 * makes the later per-frame `setStyleProperty` the only thing changing.
 */

import {
    component,
    type Define,
    type LayoutChangeEvent,
    type MainThread,
    type MainThreadRef,
} from '@sigx/lynx';

import { BANDS, bandRect } from '../game/board.js';
import type { Disc, Zone } from '../game/types.js';
import { COLORS, dimColorOf } from '../theme.js';
import DiscLayerRaw from './DiscLayerRaw.js';
import type { DiscPool } from './disc-pool.js';

export type BoardProps =
    & Define.Prop<'discs', Disc[], true>
    & Define.Prop<'width', number, true>
    & Define.Prop<'height', number, true>
    & Define.Prop<'pool', DiscPool, true>
    /** Bound so the aim gesture can attach to the board itself. */
    & Define.Prop<'elRef', MainThreadRef<MainThread.Element | null>, true>
    /** The board's own layout — its page offset maps touches into board space. */
    & Define.Prop<'onLayout', (e: LayoutChangeEvent) => void, true>;

/** Which player, if any, a band belongs to — drives the band tint. */
function tintOf(zone: Zone): string {
    if (zone === 'homeA' || zone === 'targetA') return dimColorOf(0);
    if (zone === 'homeB' || zone === 'targetB') return dimColorOf(1);
    return 'transparent';
}

const Board = component<BoardProps>(({ props }) => () => {
    const { width, height, discs, pool } = props;

    return (
        <view
            main-thread:ref={props.elRef}
            bindlayoutchange={props.onLayout}
            style={{
                position: 'relative',
                width: `${width}px`,
                height: `${height}px`,
                backgroundColor: COLORS.felt,
                borderRadius: '14px',
                overflow: 'hidden',
            }}
        >
            {BANDS.map((band) => {
                const rect = bandRect(band.zone, width, height);
                return (
                    <view
                        key={band.zone}
                        style={{
                            position: 'absolute',
                            left: '0px',
                            top: `${rect.y}px`,
                            width: `${rect.width}px`,
                            height: `${rect.height}px`,
                            backgroundColor: tintOf(band.zone),
                            // Only the lower edge, so the bands read as one
                            // continuous corridor rather than five boxes.
                            borderBottomWidth: band.zone === 'homeA' ? '0px' : '1px',
                            borderBottomStyle: 'solid',
                            borderBottomColor: COLORS.line,
                        }}
                    />
                );
            })}

            <DiscLayerRaw discs={discs.filter((d: Disc) => d.alive)} pool={pool} />
        </view>
    );
});

export default Board;
