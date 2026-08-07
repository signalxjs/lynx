/**
 * Score, whose turn it is, and each player's remaining embers.
 *
 * Ember pips are the visible form of the reload budget: a disc that keeps
 * bouncing home is spending something, and the player should be able to see
 * how much is left before it burns out.
 */

import { component, type Define } from '@sigx/lynx';

import { scoreOf } from '../game/rules.js';
import type { GameState, Owner } from '../game/types.js';
import { PLAYER_A, PLAYER_B } from '../game/types.js';
import PerfHud from '../perf/PerfHud.js';
import type { SparkBars } from '../perf/spark-bars.js';
import type { FrameStats } from '../perf/stats.js';
import { COLORS, colorOf } from '../theme.js';

/** What both the score panels and the row itself need. */
type BoardProps =
    & Define.Prop<'state', GameState, true>
    & Define.Prop<'boardHeight', number, true>;

export type HudProps =
    & BoardProps
    & Define.Prop<'stats', FrameStats, true>
    & Define.Prop<'bars', SparkBars, true>
    & Define.Prop<'isDev', boolean, true>;

type PlayerPanelProps =
    & BoardProps
    & Define.Prop<'owner', Owner, true>
    & Define.Prop<'label', string, true>;

function embersLeft(state: GameState, owner: Owner): number {
    return state.discs
        .filter((d) => d.alive && d.owner === owner)
        .reduce((sum, d) => sum + d.embers, 0);
}

const PlayerPanel = component<PlayerPanelProps>(({ props }) => () => {
    const { state, boardHeight, owner, label } = props;
    const active = state.phase !== 'over' && state.turn === owner;
    const tint = colorOf(owner);

    return (
        <view style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <text style={{ color: active ? tint : COLORS.textDim, fontSize: '13px' }}>
                {label}
            </text>
            <text style={{ color: tint, fontSize: '30px', fontWeight: 'bold' }}>
                {String(scoreOf(state, owner, boardHeight))}
            </text>
            <text style={{ color: COLORS.textDim, fontSize: '11px' }}>
                {`${embersLeft(state, owner)} embers`}
            </text>
        </view>
    );
});

/**
 * Score row, with the frame readout in the centre column where the wordmark
 * used to be.
 *
 * Putting it here rather than in a band of its own is what keeps it free: the
 * row exists regardless, and the scores are only as tall as the space the
 * sparkline needs, so the instrumentation costs the board no height. A
 * dedicated HUD strip took ~60px off the play area, which on a portrait board
 * is a visible chunk of the field.
 */
const Hud = component<HudProps>(({ props }) => () => {
    const { state, boardHeight } = props;
    const over = state.phase === 'over';

    return (
        <view
            style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingLeft: '16px',
                paddingRight: '16px',
                paddingTop: '6px',
                paddingBottom: '6px',
            }}
        >
            <PlayerPanel state={state} boardHeight={boardHeight} owner={PLAYER_B} label="BLUE" />
            <view style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {over ? (
                    <text
                        style={{ color: COLORS.text, fontSize: '12px', letterSpacing: '3px' }}
                    >
                        GAME OVER
                    </text>
                ) : null}
                <PerfHud
                    stats={props.stats}
                    bars={props.bars}
                    isDev={props.isDev}
                    discCount={state.discs.filter((d) => d.alive).length}
                />
            </view>
            <PlayerPanel state={state} boardHeight={boardHeight} owner={PLAYER_A} label="RED" />
        </view>
    );
});

export default Hud;
