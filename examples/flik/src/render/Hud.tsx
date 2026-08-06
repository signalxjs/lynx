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
import { COLORS, colorOf } from '../theme.js';

export type HudProps =
    & Define.Prop<'state', GameState, true>
    & Define.Prop<'boardHeight', number, true>;

type PlayerPanelProps =
    & HudProps
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
                paddingLeft: '28px',
                paddingRight: '28px',
                paddingTop: '10px',
                paddingBottom: '10px',
            }}
        >
            <PlayerPanel state={state} boardHeight={boardHeight} owner={PLAYER_B} label="BLUE" />
            <text style={{ color: COLORS.textDim, fontSize: '12px', letterSpacing: '3px' }}>
                {over ? 'GAME OVER' : 'FLIK'}
            </text>
            <PlayerPanel state={state} boardHeight={boardHeight} owner={PLAYER_A} label="RED" />
        </view>
    );
});

export default Hud;
