/**
 * The board: zone bands, edge, and the discs at rest.
 *
 * Static in this PR — nothing here moves yet. The simulation (PR 2) drives the
 * same disc elements through main-thread refs, so the JSX deliberately stays
 * trivially simple: each disc is one `<view>` with a fixed style object and no
 * conditional structure, which is what keeps the subtree snapshot-friendly and
 * makes the later per-frame `setStyleProperty` the only thing changing.
 */

import { component, type Define } from '@sigx/lynx';

import { BANDS, bandRect } from '../game/board.js';
import type { Disc, Zone } from '../game/types.js';
import { COLORS, colorOf, dimColorOf } from '../theme.js';

export type BoardProps =
    & Define.Prop<'discs', Disc[], true>
    & Define.Prop<'width', number, true>
    & Define.Prop<'height', number, true>;

/** Which player, if any, a band belongs to — drives the band tint. */
function tintOf(zone: Zone): string {
    if (zone === 'homeA' || zone === 'targetA') return dimColorOf(0);
    if (zone === 'homeB' || zone === 'targetB') return dimColorOf(1);
    return 'transparent';
}

const Board = component<BoardProps>(({ props }) => () => {
    const { width, height, discs } = props;

    return (
        <view
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

            {discs
                .filter((d: Disc) => d.alive)
                .map((disc: Disc) => (
                    <view
                        key={disc.id}
                        class="flik-disc"
                        style={{
                            position: 'absolute',
                            left: '0px',
                            top: '0px',
                            width: `${disc.r * 2}px`,
                            height: `${disc.r * 2}px`,
                            borderRadius: `${disc.r}px`,
                            backgroundColor: colorOf(disc.owner),
                            // Top-left positioning via transform, not left/top:
                            // this is the exact property the simulation will
                            // rewrite every frame, so the static board should
                            // already be laid out the way the moving one is.
                            transform: `translate(${disc.x - disc.r}px, ${disc.y - disc.r}px)`,
                        }}
                    />
                ))}
        </view>
    );
});

export default Board;
