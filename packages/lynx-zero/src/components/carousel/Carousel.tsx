/**
 * Carousel — a paging, horizontally scrolling viewport whose model is the
 * active slide index (zero's `carousel` scope).
 *
 * ```tsx
 * <Carousel.Root model={() => state.slide}>
 *     <Carousel.Viewport>
 *         <Carousel.Item><image src={a} /></Carousel.Item>
 *         <Carousel.Item><image src={b} /></Carousel.Item>
 *     </Carousel.Viewport>
 *     <Carousel.PrevTrigger />
 *     <Carousel.NextTrigger />
 *     <Carousel.IndicatorGroup>
 *         <Carousel.Indicator index={0} />
 *         <Carousel.Indicator index={1} />
 *     </Carousel.IndicatorGroup>
 * </Carousel.Root>
 * ```
 *
 * As on the web, the scrolling IS the mechanism — only the primitive
 * differs:
 *
 * - **The viewport is lynx's native `<scroll-view scroll-orientation=
 *   "horizontal" paging-enabled>`** — the same primitive `Swiper` in
 *   `@sigx/lynx-gestures` builds on. The web's `scroll-snap` CSS does
 *   nothing here. Android's `paging-enabled` pages a fast fling with the
 *   platform's own physics, but a slow drag rests wherever it stops
 *   (#1310); iOS's scroll-view has no paging attribute at all (#1301). So
 *   on every platform the viewport snaps itself when a scroll ends OFF a
 *   slide — to the next slide in the drag's direction once it has moved a
 *   fifth of a slide, else back (`carouselSnapIndex`), gliding there with
 *   `scrollTo`. A rest native paging already aligned is left alone, so the
 *   two never fight. One snap per rest: a glide that still lands off a
 *   slide is left alone.
 * - **The model follows real scroll.** The web derives the index from an
 *   IntersectionObserver; lynx has none, so the viewport rounds its
 *   `bindscroll` offset to a page. Setting the model (a trigger, a dot, or
 *   the app) scrolls the viewport through its `scrollTo` UI method; the
 *   intermediate pages a programmatic glide passes are not reported, so
 *   `indexChange` fires once per move.
 * - **Slides take a pixel width.** A horizontal scroll-view does not
 *   resolve `%` widths on its children, so each item is sized to the
 *   viewport's measured width (`bindlayoutchange`).
 * - **Slides are counted in mount order**, not document order — lynx has
 *   no DOM to sort by. A slide rendered conditionally later joins the end.
 * - **Prev/next clamp** (no wrap) and are `disabled` at their bounds, as on
 *   the web; there is no keyboard focus to keep, so the web's "focusable but
 *   aria-disabled" distinction collapses to disabled. Each trigger and each
 *   dot owns its press feedback (the tier-2 main-thread feel + `pressed`).
 * - **Accessibility** is the five-prop native surface: triggers and dots are
 *   `button`s named by their `label` (default "Previous slide" /
 *   "Next slide" / "Go to slide n"), the active dot is `selected`. The
 *   root, viewport and slides carry no accessibility props: marking a
 *   container an accessible element hides its content from the reader on
 *   iOS, so the web's region / "n of m" slide groups are not carried.
 * - **Web-only:** keyboard focus (`focus-visible` is never set live — the
 *   gallery forces it), `prefers-reduced-motion`, and the viewport's
 *   `:focus-visible` ring.
 *
 * The root takes no `value` prop: runtime-core resolves a component's event
 * handlers through `props.value` when one exists, which would silence
 * `indexChange`. The model is `model` / `defaultIndex`.
 */
import type { Define, LayoutChangeEvent } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, effect, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import type { InvokableElement } from '../../shared/native-text.js';
import { invokeUiMethod } from '../../shared/invoke-ui.js';

const anatomy = anatomies.carousel;

/**
 * The slide a horizontal offset shows: `scrollLeft / pageWidth`, rounded,
 * clamped to the slides that exist. `0` with no width or no slides.
 */
export function carouselPageAt(scrollLeft: number, pageWidth: number, count: number): number {
    if (!(pageWidth > 0) || count <= 0 || !Number.isFinite(scrollLeft)) return 0;
    return Math.min(count - 1, Math.max(0, Math.round(scrollLeft / pageWidth)));
}

/** How far (a fraction of a slide) a drag must travel to commit to the next slide. */
export const CAROUSEL_SNAP_COMMIT = 0.2;

/**
 * The slide a scroll that came to rest at `scrollLeft` snaps to, having
 * started from `fromLeft` — paging's rule in JS for engines whose
 * scroll-view does not page (iOS, #1301). A drag that travelled at least
 * `CAROUSEL_SNAP_COMMIT` of a slide past the slide boundary behind it
 * commits to the next slide in its direction; a shorter one falls back.
 * No direction (it rests where it started) rounds to the nearest slide.
 * Clamped to the slides that exist; `0` with no width or no slides.
 */
export function carouselSnapIndex(scrollLeft: number, pageWidth: number, count: number, fromLeft: number): number {
    if (!(pageWidth > 0) || count <= 0 || !Number.isFinite(scrollLeft)) return 0;
    const at = scrollLeft / pageWidth;
    const frac = at - Math.floor(at);
    const moved = Number.isFinite(fromLeft) ? scrollLeft - fromLeft : 0;
    let target: number;
    if (moved > 0) target = frac >= CAROUSEL_SNAP_COMMIT ? Math.ceil(at) : Math.floor(at);
    else if (moved < 0) target = frac <= 1 - CAROUSEL_SNAP_COMMIT ? Math.floor(at) : Math.ceil(at);
    else target = Math.round(at);
    return Math.min(count - 1, Math.max(0, target));
}

/** Slack (px) under which a resting offset counts as ON a slide. */
const SNAP_SLACK = 1;

/** A consumer index made whole and clamped to `[0, count - 1]` (`0` with no slides). */
export function carouselClamp(index: number | null | undefined, count: number): number {
    const whole = typeof index === 'number' && Number.isFinite(index) ? Math.floor(index) : 0;
    return count <= 0 ? Math.max(0, whole) : Math.min(count - 1, Math.max(0, whole));
}

interface CarouselContext {
    /** The active slide, clamped to the slides that exist. */
    index(): number;
    count(): number;
    /** Clamp and set the model; the viewport scrolls to it. */
    goTo(index: number): void;
    /** Real scroll reached `index` — set the model without scrolling back. */
    observed(index: number): void;
    /** Join the slide order (mount order); returns the leave function. */
    register(id: number): () => void;
    /** A slide's place in the order (`-1` when it is not registered). */
    itemIndex(id: number): number;
    /** The viewport's measured width in px (`0` until it lays out). */
    pageWidth(): number;
    setPageWidth(width: number): void;
    pressFeel(): boolean;
}

const useCarouselContext = defineInjectable<CarouselContext>(() => ({
    index: () => 0,
    count: () => 0,
    goTo: () => {},
    observed: () => {},
    register: () => () => {},
    itemIndex: () => -1,
    pageWidth: () => 0,
    setPageWidth: () => {},
    pressFeel: () => true,
}));

/** Slide ids, unique across every carousel (only compared, never shown). */
let nextItemId = 0;

// ── Root ──

export type CarouselRootProps =
    & Define.Model<number>
    /** The slide to start on when uncontrolled (0-based). Default 0. */
    & Define.Prop<'defaultIndex', number, false>
    & Define.Event<'indexChange', number>
    /** `false` turns off the main-thread press feel on the triggers and dots (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const CarouselRoot = component<CarouselRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<number>(
        () => props.model,
        props.defaultIndex ?? 0,
        (index) => emit('indexChange', index),
    );
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size }));
    // Replaced, never mutated, so a join or a leave re-renders its readers.
    const items = signal({ order: [] as number[] });
    const view = signal({ width: 0 });
    const count = (): number => items.order.length;
    const index = (): number => carouselClamp(state.value, count());

    const set = (next: number): void => {
        const clamped = carouselClamp(next, count());
        // Against the slide on screen: a clamped or NaN model renders as its
        // clamped slide, and moving there is no change.
        if (clamped !== index()) state.value = clamped;
    };

    const ctx: CarouselContext = {
        index,
        count,
        goTo: set,
        observed: set,
        register: (id) => {
            items.order = [...items.order, id];
            return () => {
                items.order = items.order.filter((other) => other !== id);
            };
        },
        itemIndex: (id) => items.order.indexOf(id),
        pageWidth: () => view.width,
        setPageWidth: (width) => {
            if (width > 0 && width !== view.width) view.width = width;
        },
        pressFeel: () => props.pressFeel !== false,
    };
    defineProvide(useCarouselContext, () => ctx);

    return () => (
        <view {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Carousel.Root' });

// ── Viewport ──

export type CarouselViewportProps =
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

interface ScrollDetail {
    scrollLeft?: number;
}

const CarouselViewport = component<CarouselViewportProps>(({ props, slots }) => {
    const carousel = useCarouselContext();
    const axes = useVariantAxes();
    let el: InvokableElement | null = null;
    // Where a programmatic glide is headed: the pages it passes on the way
    // are not the user's, so they are not reported until it lands (or the
    // scroll ends, whichever comes first).
    let heading: number | null = null;
    // The slide the scroll position shows — seeded from the initial model,
    // which `scroll-left` positions without a glide.
    let shown = carousel.index();
    let laidOut = false;
    // `scroll-left` positions the viewport without a glide: on the first
    // layout (the initial slide) and whenever the width changes (a rotation
    // keeps the slide on screen). It is re-anchored ONLY then — a value that
    // tracked every index change would jump over the glide `scrollTo` runs.
    let anchor = shown;
    let anchorWidth = 0;
    // Every platform snaps in JS (#1301 iOS, #1310 Android): Android's
    // `paging-enabled` only pages flings, and a rest it aligned is within
    // `SNAP_SLACK` of a slide, where the snap below does nothing.
    // Where the last scroll came to rest — the drag's direction is measured
    // from here. Seeded on the first layout, from the initial slide.
    let restLeft: number | null = null;
    // A snap glide is in flight: its own scrollend is the rest, never
    // another snap (one snap per rest, so a glide that lands off a slide —
    // a clamped last page — cannot ping-pong).
    let snapping = false;

    // The model moved without the scroll (a trigger, a dot, the app): glide
    // the viewport there. Only once it has a width — a page offset needs one.
    effect(() => {
        const target = carousel.index();
        const width = carousel.pageWidth();
        if (width <= 0 || target === shown) return;
        shown = target;
        heading = target;
        invokeUiMethod(el, 'scrollTo', { index: target, smooth: laidOut });
    });

    /** The scroll came to rest: report the slide, and snap onto it when it rests off one. */
    const onScrollEnd = (event: { detail?: ScrollDetail }): void => {
        heading = null;
        const left = event?.detail?.scrollLeft;
        const width = carousel.pageWidth();
        if (typeof left !== 'number' || snapping || !(width > 0)) {
            snapping = false;
            if (typeof left === 'number') restLeft = left;
            onScroll(event);
            return;
        }
        const target = carouselSnapIndex(left, width, carousel.count(), restLeft ?? shown * width);
        restLeft = target * width;
        if (target !== shown) {
            shown = target;
            carousel.observed(target);
        }
        if (Math.abs(left - target * width) <= SNAP_SLACK) return;
        snapping = true;
        heading = target;
        invokeUiMethod(el, 'scrollTo', { index: target, smooth: true });
    };

    const onScroll = (event: { detail?: ScrollDetail }): void => {
        const left = event?.detail?.scrollLeft;
        if (typeof left !== 'number') return;
        const page = carouselPageAt(left, carousel.pageWidth(), carousel.count());
        if (heading !== null) {
            if (page !== heading) return;
            heading = null;
        }
        if (page === shown) return;
        shown = page;
        carousel.observed(page);
    };

    return () => {
        const width = carousel.pageWidth();
        if (width !== anchorWidth) {
            anchorWidth = width;
            anchor = shown;
        }
        return (
            <scroll-view
                {...partBag(anatomy, 'viewport', { ...partAxes(axes()), class: props.class })}
                scroll-orientation="horizontal"
                paging-enabled
                show-scrollbar={false}
                scroll-left={anchor * width}
                ref={(node: unknown) => { el = node as InvokableElement | null; }}
                bindlayoutchange={(event: LayoutChangeEvent) => {
                    const measured = event?.detail?.width;
                    if (typeof measured === 'number') carousel.setPageWidth(measured);
                    if (measured) laidOut = true;
                }}
                bindscroll={onScroll}
                {...{
                    // Not in the scroll-view typings; a glide the user
                    // interrupted still releases its heading here.
                    bindscrollend: onScrollEnd,
                }}
            >
                {slots.default?.()}
            </scroll-view>
        );
    };
}, { name: 'Carousel.Viewport' });

// ── Item ──

export type CarouselItemProps =
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const CarouselItem = component<CarouselItemProps>(({ props, slots, onUnmounted }) => {
    const carousel = useCarouselContext();
    const axes = useVariantAxes();
    const id = ++nextItemId;
    onUnmounted(carousel.register(id));

    return () => {
        const width = carousel.pageWidth();
        const active = carousel.itemIndex(id) === carousel.index();
        return (
            <view
                {...partBag(anatomy, 'item', {
                    state: active ? 'active' : 'inactive',
                    ...partAxes(axes()),
                    class: props.class,
                })}
                // A page of the horizontal scroller: its pixel width (a `%`
                // does not resolve there), never shrunk by the row.
                style={width > 0 ? { width: `${width}px`, flexShrink: 0, flexGrow: 0 } : { flexShrink: 0 }}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Carousel.Item' });

// ── Triggers ──

export type CarouselTriggerProps =
    /** Accessible name. Defaults to "Previous slide" / "Next slide". */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    /** The trigger's content; default a `‹` / `›` glyph. */
    & Define.Slot<'default'>;

const stepTrigger = (part: 'prev-trigger' | 'next-trigger', step: -1 | 1, defaultLabel: string, glyph: string, name: string) =>
    component<CarouselTriggerProps>(({ props, slots }) => {
        const carousel = useCarouselContext();
        const axes = useVariantAxes();
        const atBound = (): boolean => (step === -1 ? carousel.index() <= 0 : carousel.index() >= carousel.count() - 1);
        // Read once: the feel is wired at setup (worklet handlers), not per render.
        const press = createPressFeedback({ isDisabled: atBound, feel: carousel.pressFeel() });

        return () => {
            const disabled = atBound();
            return (
                <view
                    {...partBag(anatomy, part, {
                        flags: { disabled, pressed: press.pressed() },
                        ...partAxes(axes()),
                        class: props.class,
                    })}
                    {...partA11y({ trait: 'button', label: props.label ?? defaultLabel, disabled })}
                    bindtap={() => {
                        if (!atBound()) carousel.goTo(carousel.index() + step);
                    }}
                    {...press.handlers}
                >
                    {slots.default?.() ?? <text>{glyph}</text>}
                </view>
            );
        };
    }, { name });

const CarouselPrevTrigger = stepTrigger('prev-trigger', -1, 'Previous slide', '‹', 'Carousel.PrevTrigger');
const CarouselNextTrigger = stepTrigger('next-trigger', 1, 'Next slide', '›', 'Carousel.NextTrigger');

// ── Indicators ──

export type CarouselIndicatorGroupProps =
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const CarouselIndicatorGroup = component<CarouselIndicatorGroupProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <view
            {...partBag(anatomy, 'indicator-group', { ...partAxes(axes()), class: props.class })}
            // The dots' row — lynx needs the direction spelled out.
            style={{ display: 'flex', flexDirection: 'row' }}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Carousel.IndicatorGroup' });

/**
 * Room around a dot that still takes its tap: the web keeps a 24px hit
 * area with the dot drawn on `::before`; lynx has no pseudo-elements, so the
 * dot IS the part and the touch area is widened instead.
 */
const DOT_HIT_SLOP = { top: '8px', bottom: '8px', left: '4px', right: '4px' };

export type CarouselIndicatorProps =
    /** Which slide this dot names and activates (0-based). */
    & Define.Prop<'index', number, true>
    /** Accessible name. Defaults to "Go to slide n". */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** One dot — a labelled button, not a tab. */
const CarouselIndicator = component<CarouselIndicatorProps>(({ props, slots }) => {
    const carousel = useCarouselContext();
    const axes = useVariantAxes();
    const press = createPressFeedback({ feel: carousel.pressFeel() });
    const idx = (): number => carouselClamp(props.index, Number.MAX_SAFE_INTEGER);

    return () => {
        const active = carousel.index() === idx();
        return (
            <view
                {...partBag(anatomy, 'indicator', {
                    state: active ? 'active' : 'inactive',
                    flags: { pressed: press.pressed() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label ?? `Go to slide ${idx() + 1}`, selected: active || undefined })}
                {...{ 'hit-slop': DOT_HIT_SLOP }}
                bindtap={() => carousel.goTo(idx())}
                {...press.handlers}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Carousel.Indicator' });

export const Carousel = compound(CarouselRoot, {
    Root: CarouselRoot,
    Viewport: CarouselViewport,
    Item: CarouselItem,
    PrevTrigger: CarouselPrevTrigger,
    NextTrigger: CarouselNextTrigger,
    IndicatorGroup: CarouselIndicatorGroup,
    Indicator: CarouselIndicator,
});
