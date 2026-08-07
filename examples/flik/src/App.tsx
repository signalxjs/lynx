/**
 * App shell. No navigation — FLIK is one screen, so a router would be pure
 * overhead in a build that exists to measure overhead.
 *
 * The board is sized from a measured layout rather than viewport units: the
 * zone bands are fractions of the board's height and every rule in `game/`
 * takes that height as an argument, so there is exactly one number the whole
 * game depends on and it has to be the real one.
 */

import {
    component,
    signal,
    useElementLayout,
    useMainThreadRef,
    type LayoutChangeEvent,
    type MainThread,
} from '@sigx/lynx';
import { SafeAreaProvider, SafeAreaView } from '@sigx/lynx-safe-area';

import { bandRect, homeZoneOf } from './game/board.js';
import { packWorld, unpackSettle } from './game/pack.js';
import { beginShot, loadableDiscs, placeDisc, rescaleBoard, settleShot } from './game/rules.js';
import { newGame } from './game/setup.js';
import type { GameState } from './game/types.js';
import { useFlickGesture } from './input/useFlickGesture.js';
import Board from './render/Board.js';
import Hud from './render/Hud.js';
import { useDiscPool } from './render/disc-pool.js';
import { useSimLoop, type SeedWorld } from './useSimLoop.js';
import { COLORS } from './theme.js';

/** Board aspect (width : height). Portrait corridor, as the bands assume. */
const ASPECT = 0.62;
/** Arena padding either side. Subtracted, or the board is styled wider than
 *  it renders and the simulation's walls sit outside the visible felt. */
const ARENA_PAD = 12;

const App = component(() => {
    const { layout, onLayoutChange } = useElementLayout();
    const { layout: boardLayout, onLayoutChange: onBoardLayout } = useElementLayout();
    // Wrapped in an object because `signal` takes one: the game state is
    // legitimately absent until the arena reports its size.
    const game = signal({ state: null as GameState | null });
    const board = signal({ width: 0, height: 0 });
    const pool = useDiscPool();
    const boardRef = useMainThreadRef<MainThread.Element | null>(null);

    /** Everything the simulation needs to own the next turn. */
    const worldFor = (state: GameState, width: number, height: number): SeedWorld => {
        const home = bandRect(homeZoneOf(state.turn), width, height);
        return {
            packed: packWorld(state.discs),
            width,
            height,
            seq: state.seq,
            turn: state.turn,
            homeY0: home.y,
            homeY1: home.y + home.height,
        };
    };

    const sim = useSimLoop({
        pool,
        boardRef,
        onSettle: (seq, packed) => {
            const current = game.state;
            if (!current) return;
            // Drop a settle from a superseded shot — a resize or a second
            // launch can land while one is still in flight.
            if (seq !== current.seq) return;
            const { state } = settleShot(current, unpackSettle(packed), board.height);
            game.state = state;
            // Hand the next turn over: the simulation needs the new ownership
            // and the new player's home band before the next aim can pick a
            // disc.
            sim.seed(worldFor(state, board.width, board.height));
        },
    });

    // Board size, derived from the measured arena. Fitting to whichever of
    // width or height binds keeps the whole board on screen on both a tall
    // phone and a short one.
    const size = (): { width: number; height: number } | null => {
        const l = layout.value;
        if (!l || l.width <= 0 || l.height <= 0) return null;
        // The layout is the arena's BORDER box; the board lives inside the
        // padding. Sizing to the border box made the board 24px wider than it
        // rendered, so the simulation's side walls sat off the felt.
        const usableW = Math.max(1, l.width - ARENA_PAD * 2);
        const height = Math.min(l.height, usableW / ASPECT);
        return { width: height * ASPECT, height };
    };

    // Deal the opening board from the first real measurement — in the layout
    // handler, not in render. Writing reactive state during render is
    // re-entrant: the write invalidates the very render that made it.
    //
    // Re-measuring matters as much as measuring. The first layout event
    // arrives BEFORE the rest of the screen has been laid out, so the arena is
    // briefly taller than it ends up; seeding once against that height leaves
    // every disc positioned for a board that no longer exists, and the ones
    // near the far edge fall outside it and get clipped.
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
            sim.seed(worldFor(fresh, dims.width, dims.height));
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
        sim.seed(worldFor(rescaled, dims.width, dims.height));
        sim.measureBoard();
    };

    // Anything that could have moved the board invalidates its measured
    // origin, so re-measure rather than trusting the layout event's own
    // coordinates (they are not in the gesture's page space).
    const handleBoardLayout = (e: LayoutChangeEvent): void => {
        onBoardLayout(e);
        sim.measureBoard();
    };

    useFlickGesture({
        boardRef,
        state: sim.state,
        loop: sim.loop,
        onShot: (discId, seq) => {
            const current = game.state;
            if (!current) return;
            // The simulation is already running. This only records WHICH disc
            // was launched, which is what lets `settleShot` tell a reload from
            // a disc that sat the shot out.
            game.state = { ...beginShot(current, discId), seq };
        },
        onPlace: (discId, x, y) => {
            const current = game.state;
            if (!current) return;
            // Repositioning does not use the turn, but the background copy has
            // to follow — otherwise the next seed would drag the disc back.
            game.state = placeDisc(current, discId, x, y);
        },
    });

    return () => {
        // Until the arena reports its size there is no honest board size to
        // lay out against, so the first frame renders an empty arena and the
        // layout event brings the board in.
        const dims = size();
        const state = game.state;
        const canShoot = state && dims
            ? loadableDiscs(state, state.turn, dims.height).length > 0
            : false;

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
                        {/*
                          * Mounted unconditionally, at zero size until the
                          * arena is measured. `useGestureDetector` binds once
                          * in `onMounted` and the main thread DROPS the
                          * registration if the element ref isn't resolvable
                          * yet — silently, with no retry. Rendering the board
                          * only once dims existed put it after App's mount, so
                          * the aim gesture was never attached at all.
                          */}
                        <Board
                            discs={state && dims ? state.discs : []}
                            width={dims ? dims.width : 0}
                            height={dims ? dims.height : 0}
                            pool={pool}
                            elRef={boardRef}
                            onLayout={handleBoardLayout}
                        />
                    </view>
                    <view
                        style={{
                            marginTop: '8px',
                            marginBottom: '14px',
                            alignItems: 'center',
                        }}
                    >
                        <text style={{ color: COLORS.textDim, fontSize: '12px' }}>
                            {state?.phase === 'over'
                                ? 'Game over'
                                : canShoot
                                    ? 'Slide one of your discs, then flick it'
                                    : 'Waiting…'}
                        </text>
                    </view>
                </SafeAreaView>
            </SafeAreaProvider>
        );
    };
});

export default App;
