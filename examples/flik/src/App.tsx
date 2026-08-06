/**
 * App shell. No navigation — FLIK is one screen, so the router would be pure
 * overhead in a build that exists to measure overhead.
 *
 * The board is sized from a measured layout rather than viewport units: the
 * zone bands are fractions of the board's height, and every rule in `game/`
 * takes that height as an argument, so there is exactly one number the whole
 * game depends on and it has to be the real one.
 */

import {
    component,
    signal,
    useElementLayout,
    type LayoutChangeEvent,
} from '@sigx/lynx';
import { SafeAreaProvider, SafeAreaView } from '@sigx/lynx-safe-area';

import { newGame } from './game/setup.js';
import type { GameState } from './game/types.js';
import Board from './render/Board.js';
import Hud from './render/Hud.js';
import { COLORS } from './theme.js';

/** Board aspect (width : height). Portrait corridor, as the bands assume. */
const ASPECT = 0.62;

const App = component(() => {
    const { layout, onLayoutChange } = useElementLayout();
    // Wrapped in an object because `signal` takes one: the game state is
    // legitimately absent until the arena reports its size.
    const game = signal({ state: null as GameState | null });

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
    const handleLayout = (e: LayoutChangeEvent): void => {
        onLayoutChange(e);
        if (game.state) return;
        const dims = size();
        if (dims) game.state = newGame(dims.width, dims.height);
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
                            paddingBottom: '12px',
                        }}
                    >
                        {state && dims
                            ? <Board discs={state.discs} width={dims.width} height={dims.height} />
                            : null}
                    </view>
                </SafeAreaView>
            </SafeAreaProvider>
        );
    };
});

export default App;
