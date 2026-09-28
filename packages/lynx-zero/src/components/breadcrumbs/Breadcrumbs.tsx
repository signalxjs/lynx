/**
 * Breadcrumbs — the trail from the hierarchy's root to the current screen
 * (zero's `breadcrumbs` scope).
 *
 * ```tsx
 * <Breadcrumbs.Root>
 *     <Breadcrumbs.List>
 *         <Breadcrumbs.Item>
 *             <Breadcrumbs.Link onPress={() => nav.navigate('/')}><text>Home</text></Breadcrumbs.Link>
 *             <Breadcrumbs.Separator />
 *         </Breadcrumbs.Item>
 *         <Breadcrumbs.Item>
 *             <Breadcrumbs.Link current><text>Anatomy</text></Breadcrumbs.Link>
 *         </Breadcrumbs.Item>
 *     </Breadcrumbs.List>
 * </Breadcrumbs.Root>
 * ```
 *
 * A long trail collapses: with `maxItems` set and more items than that, the
 * middle items are not rendered (`closed`) and the `Breadcrumbs.Ellipsis`
 * the app placed after the leading items opens in their place. Its trigger
 * expands the trail (`model:expanded`).
 *
 * ```tsx
 * <Breadcrumbs.Root maxItems={3}>
 *     <Breadcrumbs.List>
 *         <Breadcrumbs.Item>…Home…</Breadcrumbs.Item>
 *         <Breadcrumbs.Ellipsis>
 *             <Breadcrumbs.EllipsisTrigger />
 *             <Breadcrumbs.Separator />
 *         </Breadcrumbs.Ellipsis>
 *         <Breadcrumbs.Item>…</Breadcrumbs.Item>
 *     </Breadcrumbs.List>
 * </Breadcrumbs.Root>
 * ```
 *
 * The lynx spellings:
 *
 * - **Every part is a `view`.** No `<nav>` / `<ol>` / `<li>` / `<a>` exist
 *   here; put labels in `<text>` (they inherit the part's ink).
 * - **A link is a tap target, not a URL.** There is no browser to follow
 *   an `href`: a Link emits `press` and the app navigates. It is announced
 *   with the `link` trait, the current one as `selected` (the reader's
 *   nearest spelling of `aria-current="page"`); `current` stamps the
 *   `active` state, every other link `inactive`.
 * - **The separator is a real part.** Daisy draws its separator with
 *   `::before`, which lynx drops; `Breadcrumbs.Separator` is a `<text>`
 *   glyph (default `/`) the app places inside each item after its link, so
 *   it hides with its item. It is decoration, out of the accessibility tree.
 * - **Hidden is absent.** Lynx has no `hidden` attribute, so a collapsed
 *   item (`closed`) and the ellipsis outside a collapse render nothing —
 *   the platform's spelling of the anatomy's `hiddenIn: ['closed']` (the
 *   Tabs precedent). The component stays mounted, so its place in the
 *   trail survives the collapse.
 * - **Order is mount order.** The items join the trail as they mount (the
 *   ToggleGroup precedent); an item mounted later (a conditional one) joins
 *   the END of that order, whatever its position on screen.
 * - **The trigger** is a `view` with `bindtap`, the `button` trait and the
 *   name "Show N more breadcrumbs" (`label` overrides), tier-2 press
 *   feedback and the `pressed` flag. `focus-visible` is reachable through
 *   `ForceStates` only (no keyboard focus on this platform), and moving
 *   focus to the first revealed link after expanding is web-only.
 *   `press-animating` is the web ripple's bookkeeping and never stamps.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState, namedModel } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';

const anatomy = anatomies.breadcrumbs;

/** What the collapse reads — the pure inputs of {@link breadcrumbsHidden}. */
export interface BreadcrumbsCollapse {
    maxItems?: number;
    itemsBeforeCollapse?: number;
    itemsAfterCollapse?: number;
    expanded?: boolean;
}

/** A count prop: non-finite falls back, negatives clamp to 0, fractions floor. */
const count = (n: number | undefined, fallback: number): number =>
    Math.max(0, Math.floor(typeof n === 'number' && Number.isFinite(n) ? n : fallback));

/**
 * The indices (in trail order) the collapse hides from a trail of `total`
 * items — zero's rule verbatim: nothing while expanded or within
 * `maxItems`; otherwise everything between the leading
 * `itemsBeforeCollapse` (default 1) and the trailing `itemsAfterCollapse`
 * (default 1), unless those two already cover the trail. A non-finite or
 * negative `maxItems` reads as absent.
 */
export function breadcrumbsHidden(total: number, options: BreadcrumbsCollapse): number[] {
    const raw = options.maxItems;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || options.expanded) return [];
    if (total <= Math.floor(raw)) return [];
    const before = count(options.itemsBeforeCollapse, 1);
    const after = count(options.itemsAfterCollapse, 1);
    if (before + after >= total) return [];
    return Array.from({ length: total - before - after }, (_, i) => before + i);
}

interface BreadcrumbsContext {
    /** Join the trail (mount order); returns the leave function. */
    register(id: number): () => void;
    /** Whether the collapse hides item `id`. */
    isHidden(id: number): boolean;
    /** A collapse is active: the ellipsis shows. */
    collapsed(): boolean;
    hiddenCount(): number;
    expand(): void;
}

const useBreadcrumbsContext = defineInjectable<BreadcrumbsContext>(() => ({
    register: () => () => {},
    isHidden: () => false,
    collapsed: () => false,
    hiddenCount: () => 0,
    expand: () => {},
}));

/** Item ids, unique across every trail (only compared, never shown). */
let nextItemId = 0;

// ── Root ──

export type BreadcrumbsRootProps =
    /**
     * Collapse the trail when it has more items than this: the items between
     * the leading `itemsBeforeCollapse` and the trailing `itemsAfterCollapse`
     * hide behind the `Breadcrumbs.Ellipsis`. Absent → never collapses.
     */
    & Define.Prop<'maxItems', number, false>
    /** Items kept before the ellipsis while collapsed. Default 1. */
    & Define.Prop<'itemsBeforeCollapse', number, false>
    /** Items kept after the ellipsis while collapsed. Default 1. */
    & Define.Prop<'itemsAfterCollapse', number, false>
    /** Whether a collapsible trail shows every item (the ellipsis trigger sets it). */
    & Define.Model<'expanded', boolean>
    & Define.Prop<'defaultExpanded', boolean, false>
    & Define.Event<'expandedChange', boolean>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const BreadcrumbsRoot = component<BreadcrumbsRootProps>(({ props, slots, emit }) => {
    const expanded = createControllableState<boolean>(
        () => namedModel<boolean>(props.expanded),
        props.defaultExpanded ?? false,
        (v) => emit('expandedChange', v),
    );
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));
    // The items in mount order, replaced (never mutated) so a join or a
    // leave re-renders every item and the ellipsis.
    const items = signal({ order: [] as number[] });
    const hidden = (): number[] => breadcrumbsHidden(items.order.length, {
        maxItems: props.maxItems,
        itemsBeforeCollapse: props.itemsBeforeCollapse,
        itemsAfterCollapse: props.itemsAfterCollapse,
        expanded: expanded.value,
    });

    defineProvide(useBreadcrumbsContext, (): BreadcrumbsContext => ({
        register: (id) => {
            items.order = [...items.order, id];
            return () => { items.order = items.order.filter((other) => other !== id); };
        },
        isHidden: (id) => {
            const at = items.order.indexOf(id);
            return at >= 0 && hidden().includes(at);
        },
        collapsed: () => hidden().length > 0,
        hiddenCount: () => hidden().length,
        expand: () => { expanded.value = true; },
    }));

    return () => (
        <view {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Breadcrumbs.Root' });

// ── List ──

export type BreadcrumbsPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const BreadcrumbsList = component<BreadcrumbsPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'list', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Breadcrumbs.List' });

// ── Item ──

const BreadcrumbsItem = component<BreadcrumbsPartProps>(({ props, slots, onUnmounted }) => {
    const axes = useVariantAxes();
    const trail = useBreadcrumbsContext();
    const id = ++nextItemId;
    onUnmounted(trail.register(id));
    return () => {
        // hiddenIn: ['closed'] — a collapsed item renders nothing (its own
        // separator sits inside it and goes with it).
        if (trail.isHidden(id)) return null;
        return (
            <view {...partBag(anatomy, 'item', { state: 'open', ...partAxes(axes()), class: props.class })}>
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Breadcrumbs.Item' });

// ── Link ──

export type BreadcrumbsLinkProps =
    /** This is the screen the user is on: `active` state, announced as selected. */
    & Define.Prop<'current', boolean, false>
    & Define.Prop<'class', string, false>
    /** Accessible name — required when the content is not plain text. */
    & Define.Prop<'label', string, false>
    & Define.Event<'press'>
    & Define.Slot<'default'>;

const BreadcrumbsLink = component<BreadcrumbsLinkProps>(({ props, slots, emit }) => {
    const axes = useVariantAxes();
    return () => (
        <view
            {...partBag(anatomy, 'link', {
                state: props.current ? 'active' : 'inactive',
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'link', label: props.label, selected: !!props.current })}
            bindtap={() => emit('press')}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Breadcrumbs.Link' });

// ── Separator ──

const BreadcrumbsSeparator = component<BreadcrumbsPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text
            {...partBag(anatomy, 'separator', { ...partAxes(axes()), class: props.class })}
            accessibility-element={false}
        >
            {slots.default?.() ?? '/'}
        </text>
    );
}, { name: 'Breadcrumbs.Separator' });

// ── Ellipsis ──

/**
 * The stand-in for the hidden items: placed by the app after the leading
 * items, rendered only while a collapse is active. It holds the
 * `Breadcrumbs.EllipsisTrigger` and, like an item, its own separator.
 */
const BreadcrumbsEllipsis = component<BreadcrumbsPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    const trail = useBreadcrumbsContext();
    return () => {
        // hiddenIn: ['closed'] — outside a collapse there is nothing to stand in for.
        if (!trail.collapsed()) return null;
        return (
            <view {...partBag(anatomy, 'ellipsis', { state: 'open', ...partAxes(axes()), class: props.class })}>
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Breadcrumbs.Ellipsis' });

export type BreadcrumbsEllipsisTriggerProps =
    /**
     * The trigger's accessible name, given the number of hidden items.
     * Default: "Show N more breadcrumbs".
     */
    & Define.Prop<'label', (hiddenCount: number) => string, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const BreadcrumbsEllipsisTrigger = component<BreadcrumbsEllipsisTriggerProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    const trail = useBreadcrumbsContext();
    // Read once: the feel is wired at setup (worklet handlers), not per render.
    const press = createPressFeedback({ feel: props.pressFeel !== false });
    return () => {
        const n = trail.hiddenCount();
        return (
            <view
                {...partBag(anatomy, 'ellipsis-trigger', {
                    flags: { pressed: press.pressed() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({
                    trait: 'button',
                    label: props.label ? props.label(n) : `Show ${n} more breadcrumbs`,
                    expanded: false,
                })}
                bindtap={() => trail.expand()}
                {...press.handlers}
            >
                {slots.default?.() ?? <text>…</text>}
            </view>
        );
    };
}, { name: 'Breadcrumbs.EllipsisTrigger' });

export const Breadcrumbs = compound(BreadcrumbsRoot, {
    Root: BreadcrumbsRoot,
    List: BreadcrumbsList,
    Item: BreadcrumbsItem,
    Link: BreadcrumbsLink,
    Separator: BreadcrumbsSeparator,
    Ellipsis: BreadcrumbsEllipsis,
    EllipsisTrigger: BreadcrumbsEllipsisTrigger,
});
