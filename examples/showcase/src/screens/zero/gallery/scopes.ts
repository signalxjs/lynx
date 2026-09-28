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
 * `size`, `variant`) or an `extras` entry (overlays rendered open).
 *
 * Each section must fit ONE iPhone screenshot with no cell overlapping
 * another (#1192). Rather than hand-tuned page splits, every entry carries a
 * `cell` footprint model — its largest state cell per size, computed from
 * the daisy size ramp (the same token formulas the skin's CSS uses) — and
 * the axis blocks paginate from it (`axisPages`). `__tests__/layout.test.ts`
 * asserts every section fits and every cell fits its column.
 *
 * Axis values mirror the daisy skin's manifest
 * (`@sigx/zero-daisyui/lynx/manifest.json` → `components.<scope>`).
 *
 * To add a scope: an entry here (with its `cell` model), a render fn in
 * `ZeroGallery.tsx`.
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
export type GallerySize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** A cell's footprint in points: the widest / tallest state cell at one size. */
export interface CellBox {
    width: number;
    height: number;
}

export interface GalleryScope {
    title: string;
    axes: Partial<Record<GalleryAxis, readonly string[]>>;
    states: readonly GalleryState[];
    /** Extra sections the render fn draws itself (overlays open, …). */
    extras?: readonly string[];
    /** Column width in points; cells wrap inside a row. Default 76. */
    cellWidth?: number;
    /**
     * Where each row's axis label goes. `left` (default): a label column
     * beside the cells. `above`: a line above them, so the cells get the
     * full screen width — for scopes whose xl cell needs it (toast).
     */
    labels?: 'left' | 'above';
    /**
     * The footprint of the scope's largest state cell at `size`, in points,
     * from the daisy size ramp. A focus ring (a 4pt box-shadow spread) is
     * NOT part of the box: it spills into the column's 6pt right padding.
     * The color and variant axes render at the skin default, `md`.
     */
    cell: (size: GallerySize) => CellBox;
    /**
     * shoot.mjs settle tolerance — the fraction of sampled screenshot bytes
     * allowed to change between frames that still count as "settled".
     * Raise it for a scope with a perpetual animation (an indeterminate
     * progress bar). Default 0.003.
     */
    settleTolerance?: number;
}

// ── The screen and the gallery chrome, in points ─────────────────────────
// `ZeroGallery.tsx` renders with these same numbers, so the layout model and
// the rendered matrix cannot drift apart.

/** The QA device: iPhone 17 Pro, portrait. */
export const GALLERY_SCREEN = { width: 402, height: 874, safeTop: 62, safeBottom: 34 } as const;
/** Frame padding (all sides) around the section. */
export const FRAME_PADDING = 12;
/** The axis-label column (`labels: 'left'`). */
export const LABEL_WIDTH = 52;
/** Right padding inside each column: a focus ring's 4pt spread lands here. */
export const CELL_PAD = 6;
/** Gap between wrapped lines of cells (and of state labels) inside one row. */
export const LINE_GAP = 6;
/** Gap between the section's blocks: title, header, and each row. */
export const BLOCK_GAP = 8;
/** Gap between an `above` label and its cells. */
export const LABEL_GAP = 4;
/** Chrome font sizes (`zero-gallery.css`). */
export const FONT = { title: 13, head: 9, label: 10 } as const;
/**
 * Line-height and average glyph-width factors. Measured on the iOS sim at
 * 16px: a text line is ~18pt tall (1.125×) and "Item" is 33pt wide (0.52em a
 * glyph); "Changes" runs 0.56em. Both rounded up so the model over-estimates.
 */
const LEADING = 1.25;
const GLYPH = 0.56;

/** The height of one line of text at `px`. */
export function lineHeight(px: number): number {
    return px * LEADING;
}

/** An estimate of `text`'s rendered width at `px` (proportional sans). */
export function textWidth(text: string, px: number): number {
    return text.length * px * GLYPH;
}

/** The screen height a section may use: the safe frame, minus the frame's top padding. */
export const SECTION_BUDGET =
    GALLERY_SCREEN.height - GALLERY_SCREEN.safeTop - GALLERY_SCREEN.safeBottom - FRAME_PADDING;

// ── The daisy size ramp (--size-field / --size-selector = 4px, --border = 1px) ─

type Ramp = Readonly<Record<GallerySize, number>>;
const ramp = (xs: number, sm: number, md: number, lg: number, xl: number): Ramp => ({ xs, sm, md, lg, xl });

/** `--text-<size>`. */
const TEXT = ramp(12, 14, 16, 18, 20);
/** Field-family triggers (select, dialog, popover): `--size-field * 8…16`, `* 2…6` inline padding. */
const FIELD_H = ramp(32, 40, 48, 56, 64);
const FIELD_PX = ramp(8, 12, 16, 20, 24);
const FIELD_TEXT = ramp(12, 14, 14, 16, 18);
/** Selector controls (switch, slider): `--size-selector * 4…8`. */
const SELECTOR = ramp(16, 20, 24, 28, 32);
const BORDER = 1;
/** Avatar box (`--avatar-size`): `--size-selector * 6, 8, 10, 12, 16`. */
const AVATAR = ramp(24, 32, 40, 48, 64);
/** Spinner box: daisy's `loading-*`, `--size-selector * 4…8`. */
const SPINNER = ramp(16, 20, 24, 28, 32);
/** The skeleton cell: a 96pt box around one 14px line. */
const SKELETON_CELL = { width: 96, height: 18 } as const;

function fieldTrigger(label: string) {
    return (size: GallerySize): CellBox => ({
        width: 2 * BORDER + 2 * FIELD_PX[size] + textWidth(label, FIELD_TEXT[size]),
        height: FIELD_H[size],
    });
}

export const COLORS = ['primary', 'secondary', 'accent', 'neutral', 'info', 'success', 'warning', 'error'] as const;
export const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'] as const;

/** The fixed width a text-field cell gives its (fluid) field — `ZeroGallery.tsx` renders it. */
export const TEXT_FIELD_WIDTH = 150;

const DEFAULT: GalleryState = { id: 'default', label: 'default' };
const PRESSED: GalleryState = { id: 'pressed', label: 'pressed', flags: { pressed: true } };
const FOCUS: GalleryState = { id: 'focus', label: 'focus-visible', flags: { 'focus-visible': true } };
const DISABLED: GalleryState = { id: 'disabled', label: 'disabled', props: { disabled: true } };
const PRESSABLE = [DEFAULT, PRESSED, FOCUS, DISABLED] as const;

export const GALLERY_SCOPES = {
    button: {
        title: 'Button',
        axes: { color: COLORS, size: SIZES, variant: ['solid', 'outline', 'soft', 'ghost', 'dash', 'link'] },
        // Five states wrap to three lines per row — paged so each fits a screen.
        states: [...PRESSABLE, { id: 'loading', label: 'loading', props: { loading: true } }],
        // Wide enough for an xl loading button: the button is content-sized
        // and never squeezed (#1165), so a narrower cell would only show it
        // overflowing into its neighbour.
        cellWidth: 116,
        // Height `--size-field * 6…14`; padding-inline `--space-xs…2xl`. The
        // widest state is `loading`: a 1em spinner + 0.5em gap before "Btn".
        cell: (size) => {
            const font = TEXT[size];
            const px = ramp(4, 6, 12, 16, 20)[size];
            return {
                width: 2 * BORDER + 2 * px + 1.5 * font + textWidth('Btn', font),
                height: ramp(24, 32, 40, 48, 56)[size],
            };
        },
        // `modifiers`: wide, block, square, circle, active. `squeeze`: buttons
        // in boxes narrower than their content — they overflow, never break
        // a word (#1165).
        extras: ['modifiers', 'squeeze'],
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
            { id: 'readonly-on', label: 'ro·on', props: { readonly: true, checked: true } },
            { id: 'invalid', label: 'invalid', props: { invalid: true } },
        ],
        // xl is 54pt wide: 52 overlapped the next cell (#1192).
        cellWidth: 62,
        // daisy's toggle: height `--size-selector * 4…8`, width
        // `2h - 2(border + h/8)`.
        cell: (size) => {
            const h = SELECTOR[size];
            return { width: 2 * h - 2 * (BORDER + h / 8), height: h };
        },
    },
    slider: {
        title: 'Slider',
        axes: { color: COLORS, size: SIZES },
        states: [
            ...PRESSABLE,
            { id: 'readonly', label: 'readonly', props: { readonly: true } },
            { id: 'invalid', label: 'invalid', props: { invalid: true } },
            { id: 'range', label: 'range+marks', props: { range: true, marks: true } },
            { id: 'range-pressed', label: 'range held', flags: { pressed: true }, props: { range: true } },
        ],
        extras: ['vertical'],
        cellWidth: 150,
        // Fluid width; the control (and its thumb) is `--size-selector * 4…8`
        // tall, the marks sit inside the track.
        cell: (size) => ({ width: 96, height: SELECTOR[size] }),
    },
    progress: {
        title: 'Progress',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'indeterminate', label: 'indeterminate', props: { value: null } },
            { id: 'loading', label: 'loading 40%', props: { value: 40 } },
            { id: 'complete', label: 'complete', props: { value: 100 } },
        ],
        extras: ['text'],
        cellWidth: 96,
        // Fluid width; the track is `--size-selector * 1…4.5` tall.
        cell: (size) => ({ width: 60, height: ramp(4, 6, 10, 14, 18)[size] }),
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
        // Two tabs, "A" and "B": padding `--tab-py` × `--tab-px`, inside the
        // list's 4pt ring room (the box variant's list padding is also 4).
        cell: (size) => {
            const font = ramp(12, 12, 14, 16, 18)[size];
            const py = ramp(2, 4, 6, 8, 12)[size];
            const px = ramp(8, 12, 16, 20, 20)[size];
            return {
                width: 2 * (2 * px + textWidth('A', font)) + 2 * 4 + 4,
                height: 2 * py + lineHeight(font) + 2 * 4 + 2 * BORDER,
            };
        },
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
        // One bordered item, open: the trigger (padding `--space-md…2xl`)
        // plus the panel (bottom padding `--space-md…2xl`). The focus ring
        // is inset. Fluid width; the widest text is "Panel".
        cell: (size) => {
            const triggerFont = ramp(14, 14, 16, 18, 20)[size];
            const panelFont = ramp(14, 14, 16, 16, 18)[size];
            const py = ramp(8, 12, 16, 20, 20)[size];
            const px = ramp(12, 16, 20, 20, 20)[size];
            return {
                width: 2 * BORDER + 2 * px + textWidth('Panel', panelFont),
                height: 2 * BORDER + 2 * py + lineHeight(triggerFont) + py + lineHeight(panelFont),
            };
        },
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
        // Two items and a 12pt connector. An item is the marker
        // (`--size-selector * 2…4`) beside a bordered content box (margin
        // and padding `--space-xs` × `--space-md`).
        cell: (size) => {
            const marker = ramp(8, 10, 12, 14, 16)[size];
            const font = ramp(12, 12, 14, 16, 16)[size];
            const content = 2 * 4 + 2 * 4 + 2 * BORDER + lineHeight(font);
            return {
                width: marker + 2 * 8 + 2 * 8 + 2 * BORDER + textWidth('two', font),
                height: 2 * Math.max(marker, content) + 12,
            };
        },
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
        // held (forced pressed), Close disabled. `nested`: a Select opened
        // inside the open dialog — both live in the full-window outlet layer
        // (#1169), so the list must paint above the panel and the backdrop.
        // `keyboard`: a name input and a bio textarea above the footer, for
        // the soft keyboard (#1232) — focus Bio and the panel must lift so
        // the field and the footer stay above the keyboard.
        extras: ['open', 'open-states', 'nested', 'keyboard'],
        // The default 76 let the xl trigger overlap its neighbour (#1192).
        cellWidth: 100,
        cell: fieldTrigger('Open'),
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
        // `open`: two popovers anchored at mount (trigger in its open state),
        // title + description + close.
        // `open-states`: Close held (forced pressed) / Close disabled.
        extras: ['open', 'open-states'],
        cellWidth: 100,
        cell: fieldTrigger('Open'),
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
            // A value longer than the cell: it clips with an ellipsis before
            // the × chip instead of running under it (#1191).
            { id: 'clearable-long', label: 'clearable long', props: { value: 'dragonfruit', clearable: true } },
            // Each focus state forces the ring on one part only: the
            // clear-trigger sits inside the trigger, so forcing both at once
            // would overlap the two rings (#1163).
            { id: 'focus', label: 'focus-visible', flags: { 'focus-visible': true }, parts: ['trigger'], props: { value: 'apple' } },
            { id: 'clear-focus', label: 'clear focus', flags: { 'focus-visible': true }, parts: ['clear-trigger'], props: { value: 'apple', clearable: true } },
        ],
        // `open`: grouped list anchored at mount, one item selected.
        // `open-parts`: zero 0.6 parts — clear-trigger, group separators —
        // with every item held (forced pressed).
        // `open-color`: a non-default colour through the portal — the
        // selected item and its tick in secondary, not primary (#1168).
        extras: ['open', 'open-parts', 'open-color'],
        // Two columns, as wide as the screen allows.
        cellWidth: 163,
        // Fluid width. The widest state is `clearable`: "Apple", then the
        // 24pt clear chip, which sits `border + padding + 1em(sm) + 4` in
        // from the right edge, with 4pt of air on each side.
        cell: (size) => ({
            width: fieldTrigger('Apple')(size).width + 4 + 24 + 4 + 14,
            height: FIELD_H[size],
        }),
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
        // `indicator`: promise toasts (#1196) — loading / complete / error
        // marks beside the text, neutral and in role colours.
        extras: ['open', 'bottom', 'indicator'],
        // The xl toast needs ~175pt, more than two columns beside a label
        // column leave (163): "Changes stored." wrapped (#1192). Labels
        // go above the cells instead, so two columns get the full width.
        labels: 'above',
        cellWidth: 189,
        // Fluid width: padding `--space-xs…xl` × `--space-md…2xl`; the title
        // (with 1.75em reserved for the close button), the description, then
        // the action (margin-top 4, padding 2, --text-xs, bordered).
        cell: (size) => {
            const font = ramp(12, 14, 14, 16, 18)[size];
            const description = ramp(12, 12, 12, 14, 16)[size];
            const py = ramp(4, 6, 8, 12, 16)[size];
            const px = ramp(8, 8, 12, 16, 20)[size];
            return {
                width: 2 * px + Math.max(textWidth('Saved', font) + 1.75 * font, textWidth('Changes stored.', description)),
                height: 2 * py + lineHeight(font) + lineHeight(description) + 4 + 2 * 2 + lineHeight(12) + 2 * BORDER,
            };
        },
    },
    // ── Wave 2, text fields (W2C #1205) ──────────────────────────────────
    // Cells are fixed-width fields (`TEXT_FIELD_WIDTH`): a text field is
    // fluid, so the cell gives it its width. Colour reaches only the focus
    // ring (daisy's field chrome is neutral), so every colour row keeps the
    // `focus` state beside the rest.
    input: {
        title: 'Input',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'placeholder', label: 'placeholder' },
            { id: 'value', label: 'value+clear', props: { value: 'hello' } },
            { id: 'focus', label: 'focus-visible', flags: { 'focus-visible': true }, parts: ['control'], props: { value: 'hello' } },
            { id: 'clear-pressed', label: 'clear held', flags: { pressed: true }, parts: ['clear-trigger'], props: { value: 'hello' } },
            { id: 'invalid', label: 'invalid', props: { invalid: true, value: 'nope' } },
            { id: 'disabled', label: 'disabled', props: { disabled: true, value: 'hello' } },
            { id: 'readonly', label: 'readonly', props: { readonly: true, value: 'hello' } },
            { id: 'adorned', label: 'adornments', props: { adornment: true } },
            { id: 'password', label: 'password', props: { password: true, value: 'secret' } },
            { id: 'shown', label: 'shown·held', flags: { pressed: true }, parts: ['visibility-trigger'], props: { password: true, visible: true, value: 'secret' } },
        ],
        // `affordances`: start + end adornments, clear and visibility
        // triggers together, the triggers focused one at a time (#1163's
        // one-ring-per-cell rule), and a forced focus ring per colour.
        // `readonly-update`: readonly input, textarea and number input whose
        // values change after mount; each must show "after" / 7 (#1231).
        extras: ['affordances', 'readonly-update'],
        cellWidth: 163,
        // The control is `--size-field * 8…16` tall (the shared field ramp).
        cell: (size) => ({ width: TEXT_FIELD_WIDTH, height: FIELD_H[size] }),
    },
    textarea: {
        title: 'Textarea',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'placeholder', label: 'placeholder' },
            { id: 'value', label: 'value', props: { value: 'Two lines\nof text' } },
            { id: 'focus', label: 'focus-visible', flags: { 'focus-visible': true }, props: { value: 'Two lines\nof text' } },
            { id: 'invalid', label: 'invalid', props: { invalid: true } },
            // The ring's hairline takes the error edge (#1220); empty, so the
            // floor holds under the ring too (#1219).
            { id: 'invalid-focus', label: 'invalid·focus', flags: { 'focus-visible': true }, props: { invalid: true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true, value: 'Two lines\nof text' } },
            { id: 'readonly', label: 'readonly', props: { readonly: true, value: 'Two lines\nof text' } },
        ],
        // `autosize`: minRows/maxRows fields holding 1, 3 and 8 lines.
        extras: ['autosize'],
        cellWidth: 163,
        // daisy's floor: `min-height: calc(fieldHeight * 2)`.
        cell: (size) => ({ width: TEXT_FIELD_WIDTH, height: 2 * FIELD_H[size] }),
    },
    field: {
        title: 'Field',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            { id: 'required', label: 'required', props: { required: true } },
            { id: 'invalid', label: 'invalid+error', props: { invalid: true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
            { id: 'readonly', label: 'readonly', props: { readonly: true } },
            { id: 'focus', label: 'control focus', flags: { 'focus-visible': true }, parts: ['control'] },
        ],
        // `controls`: one Field each around a Textarea, a Switch and a
        // Select — every control adopts the field's flags and size.
        extras: ['controls'],
        cellWidth: 163,
        // Label, the Input control, then the description (or error), with
        // the root's `--space-sm` gap between them.
        cell: (size) => {
            const label = ramp(12, 12, 14, 16, 18)[size];
            const note = ramp(12, 12, 12, 14, 16)[size];
            return {
                width: TEXT_FIELD_WIDTH,
                height: lineHeight(label) + 6 + FIELD_H[size] + 6 + lineHeight(note),
            };
        },
    },
    // Wave 2, forms (#1204). The `pressed` flag (finger down) and the `on`
    // state (the mode) are independent, so both held cells are shown.
    toggle: {
        title: 'Toggle',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'off', label: 'off' },
            { id: 'on', label: 'on', props: { on: true } },
            { id: 'pressed', label: 'pressed', flags: { pressed: true } },
            { id: 'on-pressed', label: 'on·pressed', flags: { pressed: true }, props: { on: true } },
            { id: 'focus', label: 'focus', flags: { 'focus-visible': true }, props: { on: true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
            { id: 'disabled-on', label: 'dis·on', props: { disabled: true, on: true } },
        ],
        // `content`: a glyph + label toggle (the row layout and the label
        // ink on both states), and a toggle squeezed into a narrow box.
        extras: ['content'],
        cellWidth: 96,
        // daisy's pressed btn: padding `--space-2xs…lg` × `--space-xs…2xl`,
        // `--text-xs…xl`, a hairline border. The label is "Bold".
        cell: (size) => {
            const font = ramp(12, 14, 16, 18, 20)[size];
            const py = ramp(2, 4, 6, 8, 12)[size];
            const px = ramp(4, 6, 12, 16, 20)[size];
            return {
                width: 2 * BORDER + 2 * px + textWidth('Bold', font),
                height: 2 * BORDER + 2 * py + lineHeight(font),
            };
        },
    },
    // Three items, "A" on. Forced flags land on every item (the item is the
    // only part declaring them).
    'toggle-group': {
        title: 'Toggle group',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'default', label: 'A on' },
            { id: 'none', label: 'none on', props: { value: '' } },
            // The trailing end filled: the last item's own corners (#1218).
            { id: 'last', label: 'C on', props: { value: 'c' } },
            { id: 'pressed', label: 'pressed (all)', flags: { pressed: true } },
            { id: 'focus', label: 'focus (all)', flags: { 'focus-visible': true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
            { id: 'item-disabled', label: 'B disabled', props: { itemDisabled: true } },
            { id: 'invalid', label: 'invalid', props: { invalid: true } },
        ],
        // `vertical`: the column join (seams on the block axis) per size,
        // then the ends filled — Top on, End on, and held (#1218).
        // `multiple`: an array model with two items on, and a live group.
        extras: ['vertical', 'multiple'],
        cellWidth: 163,
        // A frame (hairline border) around three items and two hairline
        // seams; each item is padding `--space-2xs…lg` ×
        // `--space-sm…2xl` around one glyph.
        cell: (size) => {
            const font = ramp(12, 12, 14, 16, 18)[size];
            const py = ramp(2, 4, 6, 8, 12)[size];
            const px = ramp(6, 8, 12, 16, 20)[size];
            return {
                width: 2 * BORDER + 3 * (2 * px + textWidth('A', font)) + 2 * BORDER,
                height: 2 * BORDER + 2 * py + lineHeight(font),
            };
        },
    },
    // ── Wave 2 / W2A: checkbox, checkbox-group, radio-group (#1203) ──
    // Selector boxes: `--size-selector * 4…8` (the SELECTOR ramp), the row
    // gap `--space-md`, a label in `--text-xs…lg`.
    checkbox: {
        title: 'Checkbox',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'off', label: 'off' },
            { id: 'on', label: 'on', props: { checked: true } },
            { id: 'mixed', label: 'mixed', props: { indeterminate: true } },
            { id: 'pressed', label: 'held', flags: { pressed: true }, props: { checked: true } },
            { id: 'focus', label: 'focus', flags: { 'focus-visible': true }, props: { checked: true } },
            { id: 'disabled', label: 'dis', props: { disabled: true } },
            { id: 'disabled-on', label: 'dis·on', props: { disabled: true, checked: true } },
            { id: 'readonly-on', label: 'ro·on', props: { readonly: true, checked: true } },
            { id: 'invalid', label: 'invalid', props: { invalid: true } },
        ],
        // `labelled`: the label part at every size, and hideLabel.
        extras: ['labelled'],
        cellWidth: 44,
        // The bare box (no label): daisy's `.checkbox` square.
        cell: (size) => ({ width: SELECTOR[size], height: SELECTOR[size] }),
    },
    'checkbox-group': {
        title: 'CheckboxGroup',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            { id: 'pressed', label: 'held', flags: { pressed: true } },
            { id: 'focus', label: 'focus', flags: { 'focus-visible': true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
            { id: 'readonly', label: 'readonly', props: { readonly: true } },
            { id: 'invalid', label: 'inv·req', props: { invalid: true, required: true } },
        ],
        // `parent`: the tri-state select-all box over three children (some
        // checked → indeterminate). `horizontal`: orientation="horizontal".
        extras: ['parent', 'horizontal'],
        cellWidth: 58,
        // The group label, then two boxed rows "A" / "B". The label ramps
        // `--text-xs, xs, sm, md, lg`; the root gap is `--space-md`
        // (`--space-sm` at xs, `--space-lg` at xl); the boxes take the
        // group's size.
        cell: (size) => {
            const box = SELECTOR[size];
            const labelFont = ramp(12, 12, 14, 16, 18)[size];
            const boxFont = ramp(12, 14, 14, 16, 18)[size];
            const gap = ramp(6, 8, 8, 8, 12)[size];
            return {
                width: Math.max(textWidth('Pick', labelFont), box + 8 + textWidth('A', boxFont)),
                height: lineHeight(labelFont) + 2 * gap + 2 * Math.max(box, lineHeight(boxFont)),
            };
        },
    },
    'radio-group': {
        title: 'RadioGroup',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            { id: 'pressed', label: 'held', flags: { pressed: true } },
            { id: 'focus', label: 'focus', flags: { 'focus-visible': true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
            { id: 'readonly', label: 'readonly', props: { readonly: true } },
            { id: 'invalid', label: 'invalid', props: { invalid: true } },
        ],
        // `labelled`: RadioGroup.Label + data mode (`items`) with a disabled
        // item. `horizontal`: orientation="horizontal".
        extras: ['labelled', 'horizontal'],
        cellWidth: 58,
        // Two items "A" (checked) / "B": the round control beside its
        // label, rows `--space-md` apart.
        cell: (size) => {
            const box = SELECTOR[size];
            const font = ramp(12, 14, 14, 16, 18)[size];
            return {
                width: box + 8 + textWidth('A', font),
                height: 2 * Math.max(box, lineHeight(font)) + 8,
            };
        },
    },
    // W2D (#1202): cells are the field chrome alone — decrement, the
    // native input, increment. `label` shows the full anatomy (label part,
    // a custom format) at every size.
    'number-input': {
        title: 'NumberInput',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'value', label: 'value' },
            { id: 'empty', label: 'empty', props: { empty: true } },
            // The ring is the control's; the input delegates (daisy).
            { id: 'focus', label: 'focus-visible', flags: { 'focus-visible': true } },
            { id: 'inc-pressed', label: '+ pressed', flags: { pressed: true }, parts: ['increment-trigger'] },
            { id: 'at-max', label: 'at max', props: { atMax: true } },
            { id: 'invalid', label: 'invalid', props: { invalid: true } },
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
            { id: 'readonly', label: 'readonly', props: { readonly: true } },
        ],
        extras: ['label'],
        cellWidth: 163,
        // Height `--size-field * 8…16` on the control. Width: the two
        // steppers (`--space-lg` each side of a --text-sm glyph) around the
        // 5rem input, inside the control's border — the same at every size.
        cell: (size) => ({
            width: 2 * BORDER + 2 * (2 * 12 + textWidth('+', 14)) + 80,
            height: FIELD_H[size],
        }),
    },
    // W2D (#1202): a legend over one xs NumberInput, so the group flags are
    // seen reaching a control. `nested`: nested fieldsets + the legend's
    // exemption.
    fieldset: {
        title: 'Fieldset',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            { id: 'disabled', label: 'disabled', props: { disabled: true } },
            { id: 'readonly', label: 'readonly', props: { readonly: true } },
            { id: 'invalid', label: 'invalid', props: { invalid: true } },
        ],
        extras: ['nested'],
        cellWidth: 163,
        // Root padding `--space-xs` top/bottom; the legend (`--space-sm`
        // top/bottom, --text-xs…lg); a `--space-sm` gap; the xs control
        // (`--size-field * 8`).
        cell: (size) => {
            const legend = ramp(12, 12, 14, 16, 18)[size];
            return {
                width: Math.max(2 * BORDER + 2 * (2 * 12 + textWidth('+', 14)) + 80, textWidth('Shipping', legend)),
                height: 2 * 4 + 2 * 6 + lineHeight(legend) + 6 + FIELD_H.xs,
            };
        },
    },
    // W3D (#1236): the lynx divider root IS the line (zero#375); a Label
    // gets lynx-zero's drawn segments, and its placement drops the segment on
    // its side. No flags or machine states in the anatomy: the states are
    // the label forms. `vertical`: vertical rules between items, bare and
    // labelled. The thickness is daisy's block-size/inline-size, which
    // lynx sees as height/width from zero#479 on (#1250).
    divider: {
        title: 'Divider',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            { id: 'label', label: 'label', props: { label: 'or' } },
            { id: 'start', label: 'label start', props: { label: 'or', placement: 'start' } },
            { id: 'end', label: 'label end', props: { label: 'or', placement: 'end' } },
        ],
        extras: ['vertical'],
        cellWidth: 80,
        // A fixed 70pt rule; a Label is one --text-sm line (the rule is
        // 1…3pt, well inside it).
        cell: () => ({ width: 70, height: lineHeight(14) }),
    },
    // W3D (#1236): one stat per cell. `figure`: the lynx figure pinned to
    // the item's end edge (no grid on lynx); `item=error`: the item
    // re-carries color over the root's. `row` / `column`: a multi-item
    // Stats, so the between-item seams (the `first` stamp) are seen.
    stats: {
        title: 'Stats',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            { id: 'figure', label: 'figure', props: { figure: true } },
            { id: 'item', label: 'item=error', props: { itemColor: 'error' } },
        ],
        extras: ['row', 'column'],
        cellWidth: 163,
        // Item padding `--space-lg` × `--space-xl`, inside the root's
        // border; title and desc --text-xs lines around the value
        // (--text-lg…3xl). With a figure, the item keeps `--space-xl +
        // --space-md + 32pt` clear at its end.
        cell: (size) => {
            const value = ramp(18, 20, 24, 30, 30)[size];
            const text = Math.max(textWidth('Sales', 12), textWidth('129', value));
            return {
                width: 2 * BORDER + 16 + text + 16 + 8 + 32,
                height: 2 * BORDER + 2 * 12 + 2 * lineHeight(12) + lineHeight(value),
            };
        },
    },
    // W3D (#1236): icon, title and description; `actions` adds the way-out
    // band with an xs Button. No flags or machine states in the anatomy.
    'empty-state': {
        title: 'EmptyState',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            { id: 'actions', label: 'actions', props: { actions: true } },
        ],
        cellWidth: 163,
        // The root's padding and gap and the parts' text sizes step with the
        // ramp; the icon is --text-xl…2xl at leading 1 with a `--space-xs`
        // bottom margin, the actions band a `--space-sm` top margin over an
        // xs Button (24pt).
        cell: (size) => {
            const py = ramp(8, 12, 20, 30, 40)[size];
            const px = ramp(8, 12, 16, 20, 20)[size];
            const gap = ramp(2, 4, 6, 8, 12)[size];
            const icon = ramp(20, 24, 24, 24, 24)[size];
            const title = ramp(14, 16, 18, 20, 24)[size];
            const desc = ramp(12, 12, 14, 16, 16)[size];
            return {
                width: 2 * px + Math.max(textWidth('Nothing yet', desc), textWidth('No items', title)),
                height: 2 * py + icon + 4 + lineHeight(title) + lineHeight(desc) + 3 * gap + 6 + 24,
            };
        },
    },
    // ── Wave 3, display (W3B #1235) ──────────────────────────────────────
    // Cells are whole alerts — icon, title, description, close — so the
    // forced states reach the close button (the one interactive part).
    // `closed` unmounts the alert, so it has no cell: the `compose` extra
    // holds a live one to dismiss and bring back.
    alert: {
        title: 'Alert',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            { id: 'close-pressed', label: 'close pressed', flags: { pressed: true }, parts: ['close'] },
            { id: 'close-focus', label: 'close focus', flags: { 'focus-visible': true }, parts: ['close'] },
            { id: 'close-disabled', label: 'close disabled', props: { closeDisabled: true } },
        ],
        // `compose`: the optional parts left out one at a time (no icon, no
        // close, title only, description only), plus a live dismissable one.
        extras: ['compose'],
        labels: 'above',
        cellWidth: 189,
        // Fluid width. Padding (`--space-2xs…xl` × `--space-sm…2xl`) around
        // the icon column (a --text-lg glyph and `--space-md`), the title
        // over the description (both --text-sm, `--space-sm` apart), and the
        // close button's corner (a --text-md glyph and `--space-md`). From
        // zero#479 the close is a 20pt square chip (#1253): its pressed wash
        // and focus ring are squares, not tall ovals.
        cell: (size) => {
            const py = ramp(2, 4, 8, 12, 16)[size];
            const px = ramp(6, 8, 12, 16, 20)[size];
            return {
                width: 2 * px + 20 + 8 + textWidth('92% used.', 14) + 16 + 8,
                height: 2 * py + 2 * lineHeight(14) + 6,
            };
        },
    },
    // Card has no states and no interactive part: one cell per axis value —
    // header (title + description) over a body — and the bands the cell
    // leaves out (media, footer) in the extras.
    card: {
        title: 'Card',
        axes: { color: COLORS, size: SIZES },
        states: [DEFAULT],
        // `media`: a media band at the top and at the bottom (its corners
        // follow the card's). `bands`: every part at once, footer actions
        // included.
        extras: ['media', 'bands'],
        cellWidth: 163,
        // `--card-pad` (`--space-sm, md, xl, 2xl, 2xl`) around the header
        // (the --text-lg title, `--space-2xs`, the --text-sm description)
        // and the body (--text-sm at 1.5 leading); a color's 3px top rule.
        cell: (size) => {
            const pad = ramp(6, 8, 16, 20, 20)[size];
            return {
                width: 2 * pad + textWidth('Report', 18),
                height: 3 + pad + lineHeight(18) + 2 + lineHeight(14) + 2 * pad + 14 * 1.5,
            };
        },
    },
    // ── Wave 3, display (W3A #1234): badge, status, kbd ──────────────────
    // Flag-less scopes (the anatomies declare no pressed/focus flags): the
    // states are the parts and the one machine state, `running`.
    badge: {
        title: 'Badge',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            // The status dot (zero#130) following the pill's colour.
            { id: 'dot', label: 'dot', props: { dot: true } },
            { id: 'running', label: 'dot running', props: { dot: true, running: true } },
            // The dot's own colour beats the pill's (#94).
            { id: 'dot-own', label: 'dot=success', props: { dot: true, dotColor: 'success' } },
        ],
        // `dots`: every coloured dot on an uncoloured pill (at rest and
        // running), and the uncoloured dot — the pill's ink.
        extras: ['dots'],
        cellWidth: 81,
        // A pill: padding `--space-2xs…xs` × `--space-sm…xl`, `--text-xs…md`
        // at `--leading-normal` (1.5), a hairline border. The widest state
        // carries the 0.5em dot and its 0.375em gap before "Tag".
        cell: (size) => {
            const font = ramp(12, 12, 12, 14, 16)[size];
            const py = ramp(0, 0, 2, 2, 4)[size];
            const px = ramp(6, 8, 12, 12, 16)[size];
            return {
                width: 2 * BORDER + 2 * px + 0.875 * font + textWidth('Tag', font),
                height: 2 * BORDER + 2 * py + 1.5 * font,
            };
        },
    },
    status: {
        title: 'Status',
        axes: { color: COLORS, size: SIZES },
        states: [
            DEFAULT,
            // Same paint, named for the reader (an `image` element).
            { id: 'labelled', label: 'labelled', props: { label: 'Online' } },
        ],
        // `with-text`: the dot beside the text it decorates, every size.
        extras: ['with-text'],
        cellWidth: 60,
        // `--size-selector * 1.5…3.5`; the halo (a box-shadow a quarter of
        // that) spills into the column padding like a focus ring.
        cell: (size) => {
            const dot = ramp(6, 8, 10, 12, 14)[size];
            return { width: dot + dot / 2, height: dot + dot / 2 };
        },
    },
    kbd: {
        title: 'Kbd',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'key', label: 'key' },
            { id: 'word', label: 'word', props: { glyph: 'Shift' } },
            { id: 'glyph', label: 'glyph', props: { glyph: '⌘' } },
        ],
        // `shortcut`: a key combination in running text, every size.
        extras: ['shortcut'],
        cellWidth: 81,
        // The cap: a hairline border with a doubled bottom edge, padding
        // `--space-2xs…xs` × `--space-xs…lg` (the base is 2xs/md minus the
        // border), `--text-xs…md` at 1.5. The widest key is "Shift". From
        // zero#479 the cap is set in Menlo on iOS (#1254); Android keeps
        // the system face until #1260.
        cell: (size) => {
            const font = ramp(12, 12, 12, 14, 16)[size];
            const py = ramp(0, 0, 1, 2, 4)[size];
            const px = ramp(4, 6, 7, 8, 12)[size];
            return {
                width: 2 * BORDER + 2 * px + textWidth('Shift', font),
                height: 3 * BORDER + 2 * py + 1.5 * font,
            };
        },
    },
    // ── Wave 3, display (W3C #1237) ──────────────────────────────────────
    // Avatar: the load status is the component's own, so each state is a
    // real source — a bundled raster (loaded), none (the fallback is the
    // avatar, `error`), a src that fails, and one that never answers
    // (`loading`: the fallback paints over the pending image). The daisy
    // ring (a 4pt spread box-shadow) spills into the column padding.
    avatar: {
        title: 'Avatar',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'loaded', label: 'loaded', props: { src: 'face' } },
            { id: 'fallback', label: 'fallback', props: {} },
            { id: 'broken', label: 'error', props: { src: 'broken' } },
            { id: 'loading', label: 'loading', props: { src: 'pending' } },
        ],
        // `shape`: circle / square / rounded at md and xl.
        extras: ['shape'],
        cellWidth: 76,
        // `--avatar-size` = `--size-selector * 6, 8, 10, 12, 16`.
        cell: (size) => ({ width: AVATAR[size], height: AVATAR[size] }),
    },
    // Three initialled faces (the group pushes its size and colour down,
    // and stacks every face after the first) and the "+N" chip, each a
    // quarter over its neighbour: 3.25 × the avatar box. One column, so the
    // xl stack fits.
    'avatar-group': {
        title: 'AvatarGroup',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'overflow', label: 'faces + overflow', props: { count: 4 } },
            { id: 'faces', label: 'faces only', props: { count: 0 } },
        ],
        // `mixed`: an image face, a broken one, and an avatar sizing itself.
        extras: ['mixed'],
        cellWidth: 216,
        cell: (size) => ({ width: AVATAR[size] * (1 + 3 * 0.75), height: AVATAR[size] }),
    },
    // A fixed-width line of text under the skeleton: `loading` paints the
    // fill over it (the text goes transparent), `loaded` shows the text.
    // Size moves only the radius (selector below md, box from md up).
    skeleton: {
        title: 'Skeleton',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'loading', label: 'loading', props: { loading: true } },
            { id: 'loaded', label: 'loaded', props: { loading: false } },
        ],
        // `shapes`: the placeholder shapes an app draws — a line, a block, a
        // circle — loading and loaded side by side.
        extras: ['shapes'],
        cellWidth: 110,
        cell: () => ({ width: SKELETON_CELL.width, height: SKELETON_CELL.height }),
        // The pulse never settles.
        settleTolerance: 0.05,
    },
    // No state (it spins, or it is not rendered): the labelled spinner and
    // the decorative one paint the same, so both are shown to prove it.
    spinner: {
        title: 'Spinner',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'default', label: 'labelled' },
            { id: 'decorative', label: 'decorative', props: { decorative: true } },
        ],
        // `inline`: a decorative spinner beside the text that says it.
        extras: ['inline'],
        cellWidth: 76,
        // daisy's `loading-xs…xl`: `--size-selector * 4…8`.
        cell: (size) => ({ width: SPINNER[size], height: SPINNER[size] }),
        settleTolerance: 0.05,
    },
    // ── Wave 4, navigation (W4B #1257) ───────────────────────────────────
    // Navbar is pure composition (no states, no flags): the states are the
    // section sets. Each cell is a bar in a fixed 157pt box (the bar is
    // fluid; start and end share the slack).
    navbar: {
        title: 'Navbar',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'ends', label: 'start + end' },
            { id: 'center', label: 'start·center·end', props: { center: true } },
        ],
        // `compose`: real bars — a brand + button, a centred title between
        // icon buttons, a neutral bar with ghost actions.
        extras: ['compose'],
        cellWidth: 163,
        // `min-height` 2.5/3/4/5/6rem; the xl content is three --text-lg
        // words inside `--space-sm` padding.
        cell: (size) => ({ width: NAVBAR_CELL_WIDTH, height: ramp(40, 48, 64, 80, 96)[size] }),
    },
    // Breadcrumbs: the link states are the trail's (`active` on the current
    // crumb); the flags live on the ellipsis trigger only, so the pressed /
    // focus cells are collapsed trails with the trigger forced.
    breadcrumbs: {
        title: 'Breadcrumbs',
        axes: { color: COLORS, size: SIZES },
        states: [
            { id: 'trail', label: 'trail (last current)' },
            { id: 'collapsed', label: 'collapsed', props: { collapsed: true } },
            {
                id: 'pressed', label: '… pressed', flags: { pressed: true }, parts: ['ellipsis-trigger'],
                props: { collapsed: true },
            },
            {
                id: 'focus', label: '… focus-visible', flags: { 'focus-visible': true }, parts: ['ellipsis-trigger'],
                props: { collapsed: true },
            },
        ],
        // `collapse`: live trails — tap … to expand — with other
        // before/after counts, and a custom separator.
        extras: ['collapse'],
        cellWidth: 163,
        // "Home / Docs / Kit" at --text-xs…lg: three labels, two separators,
        // four `--space-xs` gaps, inside the list's `--space-xs` block padding.
        cell: (size) => {
            const font = ramp(12, 12, 14, 16, 18)[size];
            return {
                width: textWidth('HomeDocsKit', font) + 2 * textWidth('/', font) + 4 * 4,
                height: 2 * 4 + lineHeight(font),
            };
        },
    },
} as const satisfies Record<string, GalleryScope>;

/** The fixed box a navbar gallery cell gives its (fluid) bar — `ZeroGallery.tsx` renders it. */
export const NAVBAR_CELL_WIDTH = 157;

export type GalleryScopeId = keyof typeof GALLERY_SCOPES;

const AXES: readonly GalleryAxis[] = ['color', 'size', 'variant'];
const DEFAULT_CELL_WIDTH = 76;

/** The size an axis value renders at: the value itself on the size axis, else the skin default. */
export function sizeOf(axis: GalleryAxis, value: string): GallerySize {
    return axis === 'size' ? (value as GallerySize) : 'md';
}

/** The matrix geometry of a scope: its column width, columns per line, and lines per row. */
export function matrixOf(entry: GalleryScope): { cellWidth: number; columns: number; lines: number; cellArea: number } {
    const cellWidth = entry.cellWidth ?? DEFAULT_CELL_WIDTH;
    const cellArea = GALLERY_SCREEN.width - 2 * FRAME_PADDING - (entry.labels === 'above' ? 0 : LABEL_WIDTH);
    const columns = Math.max(1, Math.floor(cellArea / cellWidth));
    return { cellWidth, columns, lines: Math.ceil(entry.states.length / columns), cellArea };
}

/** The height of one row of the matrix: one axis value × every state, wrapped. */
export function rowHeight(entry: GalleryScope, axis: GalleryAxis, value: string): number {
    const { lines } = matrixOf(entry);
    const cells = lines * entry.cell(sizeOf(axis, value)).height + (lines - 1) * LINE_GAP;
    const label = lineHeight(FONT.label);
    return entry.labels === 'above' ? label + LABEL_GAP + cells : Math.max(cells, label + 4);
}

/** The height of an axis section's fixed part: the title and the state-label header. */
export function headerHeight(entry: GalleryScope): number {
    const { lines } = matrixOf(entry);
    const header = lines * lineHeight(FONT.head) + (lines - 1) * LINE_GAP;
    return lineHeight(FONT.title) + BLOCK_GAP + header + BLOCK_GAP;
}

/** The height of an axis section holding `values`, from the top of the safe frame's padding. */
export function sectionHeight(entry: GalleryScope, axis: GalleryAxis, values: readonly string[]): number {
    const rows = values.reduce((sum, value) => sum + rowHeight(entry, axis, value), 0);
    return headerHeight(entry) + rows + Math.max(0, values.length - 1) * BLOCK_GAP;
}

/**
 * An axis's values split into pages that each fit one screen. Rows are
 * first packed in order until the next would overflow `SECTION_BUDGET`,
 * which gives the fewest pages; the rows are then spread evenly over that
 * many pages when that still fits (8 colours → 4 + 4, not 6 + 2). A row
 * taller than a whole screen still gets a page of its own (the layout test
 * flags it).
 */
export function axisPages(entry: GalleryScope, axis: GalleryAxis): string[][] {
    const values = entry.axes[axis] ?? [];
    if (values.length === 0) return [];
    const packed: string[][] = [];
    let page: string[] = [];
    for (const value of values) {
        if (page.length > 0 && sectionHeight(entry, axis, [...page, value]) > SECTION_BUDGET) {
            packed.push(page);
            page = [];
        }
        page.push(value);
    }
    if (page.length > 0) packed.push(page);
    const per = Math.ceil(values.length / Math.max(1, packed.length));
    const even: string[][] = [];
    for (let i = 0; i < values.length; i += per) even.push(values.slice(i, i + per));
    const fits = even.length === packed.length && even.every((p) => sectionHeight(entry, axis, p) <= SECTION_BUDGET);
    return fits ? even : packed;
}

/** The sections of a scope, in shooting order: its axes (paged), then its extras. */
export function gallerySections(scope: GalleryScopeId): string[] {
    const entry: GalleryScope = GALLERY_SCOPES[scope];
    const out: string[] = [];
    for (const axis of AXES) {
        if (!entry.axes[axis]) continue;
        const pages = axisPages(entry, axis).length;
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
    if (!match[2]) return { kind: 'axis', axis, values };
    const slice = axisPages(entry, axis)[Number(match[2]) - 1];
    return slice ? { kind: 'axis', axis, values: slice } : null;
}
