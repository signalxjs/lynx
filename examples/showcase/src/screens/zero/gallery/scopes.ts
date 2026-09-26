/**
 * The zero state-matrix gallery's DATA half (#1141, epic #1140): one entry
 * per anatomy scope — the axis values to sweep and the interaction states to
 * force. `ZeroGallery.tsx` pairs each entry with a render fn (type-checked
 * to cover every scope here); `scripts/zero-qa/shoot.mjs` imports this file
 * directly (Node type stripping — keep it import-free, erasable TS only) to
 * know which sections a scope has.
 *
 * Every axis sweeps on its own against every state, with the other axes at
 * the skin's defaults: `button/color` is 8 colors × the states, not the
 * full color × size × variant cube. A section is one axis block (`color`,
 * `size`, `variant`) or an `extras` entry (overlays rendered open) — each
 * sized to fit one iPhone screenshot.
 *
 * Axis values mirror the daisy skin's manifest
 * (`@sigx/zero-daisyui/lynx/manifest.json` → `components.<scope>`).
 *
 * To add a scope: an entry here, a render fn in `ZeroGallery.tsx`.
 */

export interface GalleryState {
    id: string;
    label: string;
    /** Flags forced through `ForceStates` (`@sigx/lynx-zero/testing`). */
    flags?: Readonly<Record<string, boolean>>;
    /** Narrow the forced flags to these parts. */
    parts?: readonly string[];
    /** Real props for states the component drives itself (disabled, checked, value…). */
    props?: Readonly<Record<string, unknown>>;
}

export type GalleryAxis = 'color' | 'size' | 'variant';

export interface GalleryScope {
    title: string;
    axes: Partial<Record<GalleryAxis, readonly string[]>>;
    states: readonly GalleryState[];
    /** Extra sections the render fn draws itself (overlays open, …). */
    extras?: readonly string[];
    /** Cell width in points; cells wrap inside a row. Default 76. */
    cellWidth?: number;
    /**
     * Axis values per section. An axis with more values than this splits into
     * numbered pages (`color-1`, `color-2`, …) so each fits one screenshot.
     */
    rowsPerPage?: number;
    /**
     * shoot.mjs settle tolerance — the fraction of sampled screenshot bytes
     * allowed to change between frames that still count as "settled".
     * Raise it for a scope with a perpetual animation (an indeterminate
     * progress bar). Default 0.003.
     */
    settleTolerance?: number;
}

export const COLORS = ['primary', 'secondary', 'accent', 'neutral', 'info', 'success', 'warning', 'error'] as const;
export const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

const DEFAULT: GalleryState = { id: 'default', label: 'default' };
const PRESSED: GalleryState = { id: 'pressed', label: 'pressed', flags: { pressed: true } };
const FOCUS: GalleryState = { id: 'focus', label: 'focus-visible', flags: { 'focus-visible': true } };
const DISABLED: GalleryState = { id: 'disabled', label: 'disabled', props: { disabled: true } };
const PRESSABLE = [DEFAULT, PRESSED, FOCUS, DISABLED] as const;

export const GALLERY_SCOPES = {
    button: {
        title: 'Button',
        axes: { color: COLORS, size: SIZES, variant: ['solid', 'outline', 'soft', 'ghost', 'dash', 'link'] },
        // Five states wrap to two lines per row — paged so each fits a screen.
        states: [...PRESSABLE, { id: 'loading', label: 'loading', props: { loading: true } }],
        rowsPerPage: 4,
    },
    switch: {
        title: 'Switch',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'off', label: 'off' },
            { id: 'on', label: 'on', props: { checked: true } },
            { id: 'pressed', label: 'pressed', flags: { pressed: true }, props: { checked: true } },
            { id: 'focus', label: 'focus', flags: { 'focus-visible': true }, props: { checked: true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
            { id: 'disabled-on', label: 'dis·on', props: { disabled: true, checked: true } },
        ],
        cellWidth: 52,
    },
    slider: {
        title: 'Slider',
        axes: { color: COLORS, size: SIZES },
        states: PRESSABLE,
        cellWidth: 150,
        rowsPerPage: 4,
    },
    progress: {
        title: 'Progress',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'indeterminate', label: 'indeterminate', props: { value: null } },
            { id: 'loading', label: 'loading 40%', props: { value: 40 } },
            { id: 'complete', label: 'complete', props: { value: 100 } },
        ],
        cellWidth: 96,
        settleTolerance: 0.05,
    },
    tabs: {
        title: 'Tabs',
        axes: { color: COLORS, size: SIZES, variant: ['border', 'lift', 'box'] },
        states: [
            DEFAULT,
            { id: 'pressed', label: 'pressed', flags: { pressed: true } },
            { id: 'focus', label: 'focus-visible', flags: { 'focus-visible': true } },
            { id: 'disabled', label: 'disabled (2nd)', props: { disabled: true } },
            // The indicator (zero#324) follows the active tab: off the first slot.
            { id: 'second', label: 'active 2nd', props: { value: 'b' } },
        ],
        // Three tabs, the middle one active, per variant: the indicator's
        // measured geometry away from the list's origin.
        extras: ['indicator'],
        cellWidth: 150,
        rowsPerPage: 4,
    },
    accordion: {
        title: 'Accordion',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'closed', label: 'closed' },
            { id: 'open', label: 'open', props: { open: true } },
            { id: 'pressed', label: 'pressed', flags: { pressed: true } },
            { id: 'open-pressed', label: 'open·pressed', flags: { pressed: true }, props: { open: true } },
            { id: 'focus', label: 'focus', flags: { 'focus-visible': true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
        ],
        // orientation="horizontal": the items side by side (zero 0.6).
        extras: ['horizontal'],
        cellWidth: 104,
        rowsPerPage: 4,
    },
    timeline: {
        title: 'Timeline',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            { id: 'marker', label: 'marker=error', props: { markerColor: 'error' } },
        ],
        // A horizontal timeline, and a vertical one with long content (the
        // marker must stay a dot beside wrapping text, never a pill).
        extras: ['horizontal', 'long'],
        cellWidth: 150,
    },
    dialog: {
        title: 'Dialog',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'trigger', label: 'trigger' },
            { id: 'pressed', label: 'pressed', flags: { pressed: true } },
            { id: 'focus', label: 'focus', flags: { 'focus-visible': true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
        ],
        // `open`: title, description, Cancel + Close. `open-states`: Cancel
        // held (forced pressed), Close disabled.
        extras: ['open', 'open-states'],
    },
    popover: {
        title: 'Popover',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'trigger', label: 'trigger' },
            { id: 'pressed', label: 'pressed', flags: { pressed: true } },
            { id: 'focus', label: 'focus', flags: { 'focus-visible': true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
        ],
        // `open`: two popovers anchored at mount (trigger in its open state).
        // `open-states`: Close held (forced pressed) / Close disabled.
        extras: ['open', 'open-states'],
    },
    select: {
        title: 'Select',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'placeholder', label: 'placeholder' },
            { id: 'value', label: 'value', props: { value: 'apple' } },
            { id: 'pressed', label: 'pressed', flags: { pressed: true } },
            { id: 'invalid', label: 'invalid', props: { invalid: true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
            { id: 'readonly', label: 'readonly', props: { value: 'apple', readonly: true } },
            { id: 'clearable', label: 'clearable', props: { value: 'apple', clearable: true } },
        ],
        // `open`: grouped list anchored at mount, one item selected.
        // `open-parts`: zero 0.6 parts — clear-trigger, group separators —
        // with every item held (forced pressed).
        extras: ['open', 'open-parts'],
        cellWidth: 150,
        rowsPerPage: 4,
    },
    // Cells are toasts composed in place (Toast.Root + parts, no store, no
    // portal) so ForceStates reaches the action and close; `open` / `bottom`
    // are live viewports in the overlay outlet (placement + stacking).
    toast: {
        title: 'Toast',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            { id: 'close-pressed', label: 'close pressed', flags: { pressed: true }, parts: ['close'] },
            { id: 'action-pressed', label: 'action pressed', flags: { pressed: true }, parts: ['action'] },
            FOCUS,
            { id: 'action-disabled', label: 'action disabled', props: { actionDisabled: true } },
        ],
        extras: ['open', 'bottom'],
        cellWidth: 156,
        rowsPerPage: 2,
    },
} as const satisfies Record<string, GalleryScope>;

export type GalleryScopeId = keyof typeof GALLERY_SCOPES;

const AXES: readonly GalleryAxis[] = ['color', 'size', 'variant'];

function pagesOf(entry: GalleryScope, axis: GalleryAxis): number {
    const values = entry.axes[axis] ?? [];
    return entry.rowsPerPage ? Math.ceil(values.length / entry.rowsPerPage) : 1;
}

/** The sections of a scope, in shooting order: its axes (paged), then its extras. */
export function gallerySections(scope: GalleryScopeId): string[] {
    const entry: GalleryScope = GALLERY_SCOPES[scope];
    const out: string[] = [];
    for (const axis of AXES) {
        if (!entry.axes[axis]) continue;
        const pages = pagesOf(entry, axis);
        if (pages <= 1) out.push(axis);
        else for (let page = 1; page <= pages; page++) out.push(`${axis}-${page}`);
    }
    return [...out, ...(entry.extras ?? [])];
}

export type ParsedSection =
    | { kind: 'axis'; axis: GalleryAxis; values: readonly string[] }
    | { kind: 'extra'; id: string };

/**
 * Resolve a section id against a scope. An axis id without a page number
 * (`color`) means the whole axis even when it is paged — handy by hand,
 * though it may overflow one screen.
 */
export function parseSection(entry: GalleryScope, section: string): ParsedSection | null {
    if (entry.extras?.includes(section)) return { kind: 'extra', id: section };
    const match = /^(color|size|variant)(?:-(\d+))?$/.exec(section);
    if (!match) return null;
    const axis = match[1] as GalleryAxis;
    const values = entry.axes[axis];
    if (!values) return null;
    if (!match[2] || !entry.rowsPerPage) return { kind: 'axis', axis, values };
    const page = Number(match[2]);
    const slice = values.slice((page - 1) * entry.rowsPerPage, page * entry.rowsPerPage);
    return slice.length > 0 ? { kind: 'axis', axis, values: slice } : null;
}
