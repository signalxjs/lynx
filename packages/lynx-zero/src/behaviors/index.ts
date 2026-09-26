/**
 * The behavior layer: `@sigx/zero`'s portable behaviors re-exported (zero
 * stays the single implementation), plus the lynx implementations of the
 * adapter-seamed ones. The web-only behaviors (roving keyboard focus,
 * typeahead, `:focus-visible` detection, spin-press repeat) have no lynx
 * counterpart in v1 — they are moot on a touch platform.
 */

// Portable — straight from @sigx/zero/behaviors/core. The list controller
// runs in registration-order mode here (never hand it elements; depth-first
// render order IS visual order on this platform). The collection core
// (zero 0.3) is items-as-data with key/label/value/group accessors — what
// Select builds on; `segmentBy` is the grouping walk (`segmentOptions`
// and the `options` sugar are gone upstream).
export type {
    Collection,
    CollectionEntry,
    CollectionOptions,
    CollectionSegment,
    ControllableState,
    FieldContext,
    HighlightStep,
    IdGenerator,
    ItemElement,
    ListController,
    ListItem,
} from '@sigx/zero/behaviors/core';
export {
    createCollection,
    createControllableState,
    createId,
    createListController,
    defaultItemKey,
    defaultItemLabel,
    moveHighlight,
    provideFieldContext,
    segmentBy,
    useFieldContext,
    useIdGenerator,
    zeroPlugin,
} from '@sigx/zero/behaviors/core';

// Lynx implementations.
export type {
    LynxMainThreadPressHandlers, LynxPressFeedback, LynxPressFeedbackOptions, LynxPressFeel, LynxPressHandlers,
    LynxTier1PressHandlers, MainThreadTouch,
} from './press.js';
export { PRESSED_OPACITY, PRESSED_SCALE, createPressFeedback } from './press.js';
export type { LynxDismissLayer } from './dismiss.js';
export { clearDismissLayers, dismissTopLayer, openLayerCount, registerDismissLayer } from './dismiss.js';
export type { AnchorPositionOptions, LynxAnchorPosition, LynxPlacement, ResolvedPosition } from './position.js';
export { computeAnchorPosition, computeOutletPosition, createAnchorPosition, provideOverlayOrigin, toOutletCoordinates } from './position.js';
