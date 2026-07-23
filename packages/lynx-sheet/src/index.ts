/**
 * @sigx/lynx-sheet — the unified bottom sheet for sigx-lynx.
 *
 * This package is landing in stages (signalxjs/lynx#774): the pure detent
 * model and drag/snap math ship first; the sheet engine and the standalone
 * `<BottomSheet>` component follow, and lynx-navigation's
 * `presentation: 'sheet'` rebuilds on the same engine.
 */
export {
    DEFAULT_DETENT_FRACTION,
    DEFAULT_KEYBOARD_FALLBACK_PX,
    resolveDetents,
    type DetentEnv,
    type DetentSpec,
} from './detents.js';
export {
    decideDragOwner,
    GRABBER_HEIGHT,
    MAX_EPS_PX,
    nearestDetentIndex,
    OWNER_CONTENT,
    OWNER_SHEET,
    OWNER_UNDECIDED,
    PROJECTION_SEC,
    projectReveal,
    REVEAL_MIN_DURATION_SEC,
    revealDurationSec,
    shouldDismiss,
    type DragOwnerInput,
} from './math.js';
