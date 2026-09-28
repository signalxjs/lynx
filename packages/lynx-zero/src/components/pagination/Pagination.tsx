/**
 * Pagination — a page picker over a numbered range, windowed with ellipses
 * (zero's `pagination` scope).
 *
 * ```tsx
 * <Pagination.Root count={12} model={() => state.page} withEdges />
 * ```
 *
 * Options-driven, like zero's: the visible row derives from `count`, the
 * `page` model and the windowing props, so the root renders the controls
 * itself. The window is zero's constant-width shape (`paginationRow`):
 * boundary pages at both ends, `siblingCount` pages around the current one,
 * an ellipsis where the row elides — near an edge the sibling block slides
 * rather than shrinking, so the row never changes width as the user walks it.
 *
 * What the platform changes:
 * - **Every control is a `view` with `bindtap`** and the `button` trait —
 *   lynx has no `<button>`. The current page is announced `selected` (the
 *   native readers' closest word for `aria-current="page"`), and each page
 *   is named by `pageLabel` (default "Page N"); the triggers by their
 *   `…Label` props, never by the glyph.
 * - **Every control owns its press feedback.** Each is its own component,
 *   keyed by its row slot, so a press is tier 2 (the main-thread scale) plus
 *   the `pressed` flag, and a page that slides in gets a fresh one.
 * - **A bound is `disabled`.** Prev/first on page 1 and next/last on the
 *   last page are inert and stamp the `disabled` flag, as does every control
 *   under a disabled root. There is no keyboard focus to keep, so the web's
 *   "focusable but aria-disabled" distinction collapses to disabled.
 * - **No link mode.** zero's `getPageHref` renders `<a href>`; lynx has no
 *   anchors or URLs to crawl, so the prop is not taken — handle `pageChange`
 *   and navigate from it.
 * - **No landmark.** Lynx has no `nav` role; marking the root an accessible
 *   element would hide its controls from the reader on iOS, so the root
 *   carries no accessibility props (ToggleGroup's rule) and zero's `label`
 *   is not taken.
 *
 * The root takes no `value` prop: runtime-core resolves a component's event
 * handlers through `props.value` when one exists, which would silence
 * `pageChange`. The model is `model` / `defaultPage`.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';

const anatomy = anatomies.pagination;

/** One slot of the computed row: a page number, or which ellipsis. */
export type PaginationRowEntry = number | 'start-ellipsis' | 'end-ellipsis';

const range = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (let i = from; i <= to; i += 1) out.push(i);
    return out;
};

/** Whole, at least `min` — consumer numbers are sanitized at every source. */
const intAtLeast = (n: number | undefined, min: number): number =>
    Math.max(min, Math.floor(typeof n === 'number' && Number.isFinite(n) ? n : min));

/**
 * The constant-width window — zero's `paginationRow`, verbatim (the web
 * module that exports it is DOM-bound, so it cannot be imported here):
 * boundary pages at both ends, `siblingCount` pages around the current one,
 * ellipses where the row elides, and near an edge the sibling block slides
 * instead of shrinking, so page 1 of many shows as wide a row as page 5.
 */
export function paginationRow(
    page: number,
    count: number,
    siblingCount: number,
    boundaryCount: number,
): PaginationRowEntry[] {
    const startPages = range(1, Math.min(boundaryCount, count));
    const endPages = range(Math.max(count - boundaryCount + 1, boundaryCount + 1), count);

    const siblingsStart = Math.max(
        Math.min(page - siblingCount, count - boundaryCount - siblingCount * 2 - 1),
        boundaryCount + 2,
    );
    const siblingsEnd = Math.min(
        Math.max(page + siblingCount, boundaryCount + siblingCount * 2 + 2),
        count - boundaryCount - 1,
    );

    return [
        ...startPages,
        ...(siblingsStart > boundaryCount + 2
            ? ['start-ellipsis' as const]
            : boundaryCount + 1 < count - boundaryCount
                ? [boundaryCount + 1]
                : []),
        ...range(siblingsStart, siblingsEnd),
        ...(siblingsEnd < count - boundaryCount - 1
            ? ['end-ellipsis' as const]
            : count - boundaryCount > boundaryCount
                ? [count - boundaryCount]
                : []),
        ...endPages,
    ];
}

type TriggerPart = 'first-trigger' | 'prev-trigger' | 'next-trigger' | 'last-trigger';
type ControlPart = 'item' | TriggerPart;

const GLYPH: Record<TriggerPart, string> = {
    'first-trigger': '«',
    'prev-trigger': '‹',
    'next-trigger': '›',
    'last-trigger': '»',
};

interface PaginationContext {
    select(page: number): void;
    pressFeel(): boolean;
}

const usePaginationContext = defineInjectable<PaginationContext>(() => ({
    select: () => {},
    pressFeel: () => true,
}));

// ── Root ──

export type PaginationRootProps =
    & Define.Model<number>
    /** The page to start on when uncontrolled. Default 1. */
    & Define.Prop<'defaultPage', number, false>
    & Define.Event<'pageChange', number>
    /** Total number of pages. */
    & Define.Prop<'count', number, true>
    /** Pages shown on each side of the current page. Default 1. */
    & Define.Prop<'siblingCount', number, false>
    /** Pages pinned at each end of the row. Default 1. */
    & Define.Prop<'boundaryCount', number, false>
    /** Render the first-page and last-page triggers (`«`/`»`) outside prev/next. Default false. */
    & Define.Prop<'withEdges', boolean, false>
    /** Accessible name of the previous-page trigger. Default "Previous page". */
    & Define.Prop<'prevLabel', string, false>
    /** Accessible name of the next-page trigger. Default "Next page". */
    & Define.Prop<'nextLabel', string, false>
    /** Accessible name of the first-page trigger. Default "First page". */
    & Define.Prop<'firstLabel', string, false>
    /** Accessible name of the last-page trigger. Default "Last page". */
    & Define.Prop<'lastLabel', string, false>
    /** Accessible name of page `n`. Default `(n) => \`Page ${n}\``. */
    & Define.Prop<'pageLabel', (n: number) => string, false>
    & Define.Prop<'disabled', boolean, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>;

const PaginationRoot = component<PaginationRootProps>(({ props, emit }) => {
    const state = createControllableState<number>(
        () => props.model,
        props.defaultPage ?? 1,
        (page) => emit('pageChange', page),
    );
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size }));
    const count = (): number => intAtLeast(props.count, 1);
    // A float or NaN from the consumer would render fractional pages and
    // unstable keys — every number is clamped to a whole page in range.
    const page = (): number => Math.min(intAtLeast(state.value, 1), count());
    const disabled = (): boolean => !!props.disabled;

    defineProvide(usePaginationContext, () => ({
        select: (value: number): void => {
            if (disabled()) return;
            const next = Math.min(intAtLeast(value, 1), count());
            // Against the page on screen, not the raw model: an out-of-range
            // or NaN model renders clamped, and tapping that page is no change.
            if (next !== page()) state.value = next;
        },
        pressFeel: () => props.pressFeel !== false,
    }));

    const trigger = (part: TriggerPart) => {
        const toStart = part === 'first-trigger' || part === 'prev-trigger';
        const target = part === 'prev-trigger'
            ? page() - 1
            : part === 'next-trigger'
                ? page() + 1
                : part === 'first-trigger' ? 1 : count();
        const atBound = toStart ? page() <= 1 : page() >= count();
        const label = {
            'first-trigger': props.firstLabel ?? 'First page',
            'prev-trigger': props.prevLabel ?? 'Previous page',
            'next-trigger': props.nextLabel ?? 'Next page',
            'last-trigger': props.lastLabel ?? 'Last page',
        }[part];
        return (
            <PaginationControl
                key={part}
                part={part}
                target={target}
                inert={disabled() || atBound}
                label={label}
                content={GLYPH[part]}
            />
        );
    };

    return () => {
        const current = page();
        const row = paginationRow(current, count(), intAtLeast(props.siblingCount ?? 1, 0), intAtLeast(props.boundaryCount ?? 1, 0));
        return (
            <view
                {...partBag(anatomy, 'root', {
                    flags: { disabled: disabled() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
            >
                {props.withEdges ? trigger('first-trigger') : null}
                {trigger('prev-trigger')}
                {/* Keyed by row slot — the page number or which ellipsis —
                    so a sliding window moves a page's control rather than
                    patching it in place to show another page. */}
                {row.map((entry) => (typeof entry === 'number'
                    ? (
                        <PaginationControl
                            key={`page-${entry}`}
                            part="item"
                            target={entry}
                            active={entry === current}
                            inert={disabled()}
                            label={props.pageLabel ? props.pageLabel(entry) : `Page ${entry}`}
                            content={String(entry)}
                        />
                    )
                    : <PaginationEllipsis key={entry} />))}
                {trigger('next-trigger')}
                {props.withEdges ? trigger('last-trigger') : null}
            </view>
        );
    };
}, { name: 'Pagination.Root' });

// ── Controls ──

type PaginationControlProps =
    & Define.Prop<'part', ControlPart, true>
    /** The page a tap moves to. */
    & Define.Prop<'target', number, true>
    /** A page item only: whether it is the current page. */
    & Define.Prop<'active', boolean, false>
    /** "This press does nothing": the root disabled, or a trigger at its bound. */
    & Define.Prop<'inert', boolean, true>
    & Define.Prop<'label', string, true>
    & Define.Prop<'content', string, true>;

/** One page item or trigger — its own component, so it owns its press feedback. */
const PaginationControl = component<PaginationControlProps>(({ props }) => {
    const pagination = usePaginationContext();
    const axes = useVariantAxes();
    // Read once: the feel is wired at setup (worklet handlers), not per render.
    const press = createPressFeedback({ isDisabled: () => props.inert, feel: pagination.pressFeel() });

    return () => {
        const isItem = props.part === 'item';
        const active = isItem && !!props.active;
        return (
            <view
                {...partBag(anatomy, props.part, {
                    state: isItem ? (active ? 'active' : 'inactive') : undefined,
                    flags: { disabled: props.inert, pressed: press.pressed() },
                    ...partAxes(axes()),
                })}
                {...partA11y({ trait: 'button', label: props.label, selected: active || undefined, disabled: props.inert })}
                bindtap={() => {
                    if (!props.inert) pagination.select(props.target);
                }}
                {...press.handlers}
            >
                <text>{props.content}</text>
            </view>
        );
    };
}, { name: 'Pagination.Control' });

/** Where the window elides — punctuation, hidden from the reader. */
const PaginationEllipsis = component(() => {
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'ellipsis', partAxes(axes()))} accessibility-element={false}>
            <text>…</text>
        </view>
    );
}, { name: 'Pagination.Ellipsis' });

export const Pagination = compound(PaginationRoot, {
    Root: PaginationRoot,
});
