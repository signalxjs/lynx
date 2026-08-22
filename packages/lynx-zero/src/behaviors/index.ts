/**
 * The behavior layer: `@sigx/zero`'s portable behaviors re-exported (zero
 * stays the single implementation), plus the lynx implementations of the
 * adapter-seamed ones. The web-only behaviors (roving keyboard focus,
 * typeahead, `:focus-visible` detection, spin-press repeat) have no lynx
 * counterpart in v1 — they are moot on a touch platform.
 */

// Portable — straight from @sigx/zero/behaviors/core. The list controller
// runs in registration-order mode here (never hand it elements; depth-first
// render order IS visual order on this platform).
export type { ControllableState, FieldContext, HighlightStep, IdGenerator, ItemElement, ListController, ListItem, OptionInput, OptionSegment } from '@sigx/zero/behaviors/core';
export {
    createControllableState,
    createId,
    createListController,
    moveHighlight,
    provideFieldContext,
    segmentOptions,
    useFieldContext,
    useIdGenerator,
    zeroPlugin,
} from '@sigx/zero/behaviors/core';

// Lynx implementations.
export type { LynxPressFeedback, LynxPressFeedbackOptions } from './press.js';
export { createPressFeedback } from './press.js';
export type { LynxDismissLayer } from './dismiss.js';
export { clearDismissLayers, dismissTopLayer, openLayerCount, registerDismissLayer } from './dismiss.js';
export type { AnchorPositionOptions, LynxAnchorPosition, LynxPlacement, ResolvedPosition } from './position.js';
export { computeAnchorPosition, createAnchorPosition, provideOverlayOrigin, toOutletCoordinates } from './position.js';
