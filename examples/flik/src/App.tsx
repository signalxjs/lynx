/**
 * App shell. No navigation — FLIK is one screen, so the router would be pure
 * overhead in a build that exists to measure overhead.
 *
 * The board is sized from a measured layout rather than viewport units: the
 * zone bands are fractions of the board's height, and every rule in `game/`
 * takes that height as an argument, so there is exactly one number the whole
 * game depends on and it has to be the real one.
 *
 * There is no aim gesture yet — that is the next PR. "Kick" flings every disc,
 * which is enough to see the simulation working and to exercise the settle
 * path end to end.
 */

import {
    component,
    signal,
    useElementLayout,
    type LayoutChangeEvent,
} from '@sigx/lynx';
import { SafeAreaProvider, SafeAreaView } from '@sigx/lynx-safe-area';

import { packWorld, unpackSettle } from './game/pack.js';
import { rescaleBoard, settleShot } from './game/rules.js';
import { newGame } from './game/setup.js';
import type { GameState } from './game/types.js';
import Board from './render/Board.js';
import Hud from './render/Hud.js';
import { useDiscPool } from './render/disc-pool.js';
import { useSimLoop } from './useSimLoop.js';
import { COLORS } from './theme.js';

/** Board aspect (width : height). Portrait corridor, as the bands assume. */
const ASPECT = 0.62;

const App = component(() => {
    const { layout, onLayoutChange } = useElementLayout();
    // Wrapped in an object because `signal` takes one: the game state is
    // legitimately absent until the arena reports its size.
    const game = signal({ state: null as GameState | null });
    const board = signal({ width: 0, height: 0 });
    const pool = useDiscPool();

    const sim = useSimLoop({
        pool,
        onSettle: (seq, packed) => {
            const current = game.state;
            if (!current) return;
            // Drop a settle from a superseded shot — a re-kick can land while
            // one is still in flight.
            if (seq !== current.seq) return;
            const { state } = settleShot(current, unpackSettle(packed), board.height);
            game.state = state;
        },
    });

    // Board size, derived from the measured arena. Fitting to whichever of
    // width or height binds keeps the whole board on screen on both a tall
    // phone and a short one.
    const size = (): { width: number; height: number } | null => {
        const l = layout.value;
        if (!l || l.width <= 0 || l.height <= 0) return null;
        const height = Math.min(l.height, l.width / ASPECT);
        return { width: height * ASPECT, height };
    };

    // Deal the opening board from the first real measurement — in the layout
    // handler, not in render. Writing reactive state during render is
    // re-entrant: the write invalidates the very render that made it.
    //
    // Re-measuring matters as much as measuring. The first layout event
    // arrives BEFORE the KICK button below has been laid out, so the arena is
    // briefly taller than it ends up; seeding once against that height leaves
    // every disc positioned for a board that no longer exists, and the ones
    // near the far edge fall outside it and get clipped. Rescaling on every
    // size change is also what will keep the board honest through a keyboard
    // or inset change.
    const handleLayout = (e: LayoutChangeEvent): void => {
        onLayoutChange(e);
        const dims = size();
        if (!dims) return;

        const current = game.state;
        if (!current) {
            const fresh = newGame(dims.width, dims.height);
            board.width = dims.width;
            board.height = dims.height;
            game.state = fresh;
            sim.seed(packWorld(fresh.discs), dims.width, dims.height, fresh.seq);
            return;
        }

        // Sub-pixel churn isn't worth a re-seed.
        const dw = dims.width - board.width;
        const dh = dims.height - board.height;
        if (dw * dw + dh * dh < 1) return;

        const rescaled = rescaleBoard(
            current,
            board.width > 0 ? dims.width / board.width : 1,
            board.height > 0 ? dims.height / board.height : 1,
        );
        board.width = dims.width;
        board.height = dims.height;
        game.state = rescaled;
        sim.seed(packWorld(rescaled.discs), dims.width, dims.height, rescaled.seq);
    };

    const kick = (): void => {
        const current = game.state;
        if (!current) return;
        // Bump the sequence first, and re-seed from the board the ruleset
        // currently believes in — so the settle this produces is recognised
        // as belonging to this kick and starts from the right positions.
        const seq = current.seq + 1;
        game.state = { ...current, seq };
        sim.seed(packWorld(current.discs), board.width, board.height, seq);
        sim.kick(900);
    };

    return () => {
        // Until the arena reports its size there is no honest board size to
        // lay out against, so the first frame renders an empty arena and the
        // layout event brings the board in.
        const dims = size();
        const state = game.state;

        return (
            <SafeAreaProvider>
                <SafeAreaView
                    edges={['top', 'bottom', 'left', 'right']}
                    style={{ backgroundColor: COLORS.backdrop }}
                >
                    {state && dims ? <Hud state={state} boardHeight={dims.height} /> : null}
                    <view
                        bindlayoutchange={handleLayout}
                        style={{
                            flex: '1',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            paddingLeft: '12px',
                            paddingRight: '12px',
                        }}
                    >
                        {state && dims ? (
                            <Board
                                discs={state.discs}
                                width={dims.width}
                                height={dims.height}
                                pool={pool}
                            />
                        ) : null}
                    </view>
                    <view
                        bindtap={kick}
                        style={{
                            marginTop: '10px',
                            marginBottom: '12px',
                            marginLeft: '28px',
                            marginRight: '28px',
                            paddingTop: '12px',
                            paddingBottom: '12px',
                            borderRadius: '10px',
                            backgroundColor: COLORS.line,
                            alignItems: 'center',
                        }}
                    >
                        <text
                            style={{ color: COLORS.text, fontSize: '14px', letterSpacing: '2px' }}
                        >
                            KICK
                        </text>
                    </view>
                </SafeAreaView>
            </SafeAreaProvider>
        );
    };
});

export default App;
