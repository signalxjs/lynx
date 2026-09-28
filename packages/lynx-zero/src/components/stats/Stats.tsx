/**
 * Stats — figures with their labels in a row or a column, zero's anatomy on
 * lynx.
 *
 * ```tsx
 * <Stats.Root>
 *     <Stats.Item>
 *         <Stats.Figure><Icon name="wallet" /></Stats.Figure>
 *         <Stats.Title>Total revenue</Stats.Title>
 *         <Stats.Value>$12,930</Stats.Value>
 *         <Stats.Desc>+8% month over month</Stats.Desc>
 *     </Stats.Item>
 *     <Stats.Item color="warning">
 *         <Stats.Title>Refunds</Stats.Title>
 *         <Stats.Value>31</Stats.Value>
 *     </Stats.Item>
 * </Stats.Root>
 * ```
 *
 * No behaviour and no state. The wiring is what lynx's selector engine
 * cannot see for itself:
 *
 * - **Orientation reaches every item** (zero does this too): the
 *   between-item seam is directional CSS on the ITEM.
 * - **The first item is stamped.** The web draws the seam with `item + item`;
 *   lynx has no sibling combinator and no `:first-child`, so the root tracks
 *   its items in mount order and stamps the first one `first`
 *   (`zx-m-first` / `data-mod-first`). The skin draws every item's leading
 *   seam and takes it off the first — the same answer ToggleGroup's join ends
 *   use.
 * - **An item with a Figure is stamped.** The web places the figure in a
 *   grid column beside the text bands; lynx has no grid, so the skin lays the
 *   bands out as a column and pins the figure to the item's end edge, and an
 *   item holding one is stamped `figure` (`zx-m-figure`) so the skin can keep
 *   the bands clear of it.
 * - **The item re-carries `color`** (the anatomy's `carries`, zero#161):
 *   `color` on one Item colours that stat alone and outranks the Root's; the
 *   bands inside follow their item (`provideCarriedAxes`).
 *
 * The text bands (`Title`, `Value`, `Desc`) render as lynx `<text>`, so they
 * take a plain string. `Figure` is a view for an icon or an avatar.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideCarriedAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { joinAfterMount } from '../../shared/join-after-mount.js';

const anatomy = anatomies.stats;

type Orientation = 'horizontal' | 'vertical';

interface StatsContext {
    orientation(): Orientation;
    /** An item joins the root's order (mount order); returns the leave function. */
    register(id: number): () => void;
    /** Whether item `id` is the first in the row. */
    isFirst(id: number): boolean;
}

const useStatsContext = defineInjectable<StatsContext>(() => ({
    orientation: () => 'horizontal',
    register: () => () => {},
    isFirst: () => false,
}));

interface StatsItemContext {
    /** A Figure reports itself; returns the leave function. */
    addFigure(): () => void;
}

const useStatsItemContext = defineInjectable<StatsItemContext>(() => ({
    addFigure: () => () => {},
}));

/** Item ids, unique across every Stats (only compared, never shown). */
let nextItemId = 0;

export type StatsRootProps =
    & Define.Prop<'orientation', Orientation, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const StatsRoot = component<StatsRootProps>(({ props, slots }) => {
    const orientation = (): Orientation => props.orientation ?? 'horizontal';
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size }));
    // The items in mount order, replaced (never mutated) so a join or a
    // leave re-renders the first item.
    const items = signal({ order: [] as number[] });
    defineProvide(useStatsContext, () => ({
        orientation,
        register: (id) => {
            items.order = [...items.order, id];
            return () => {
                items.order = items.order.filter((other) => other !== id);
            };
        },
        isFirst: (id) => items.order[0] === id,
    }));
    return () => (
        <view {...partBag(anatomy, 'root', { orientation: orientation(), ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Stats.Root' });

export type StatsPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

/** The item takes the scope's colour vocabulary for itself (zero#161): its own value outranks the Root's. */
export type StatsItemProps = Define.Prop<'color', string, false> & StatsPartProps;

const StatsItem = component<StatsItemProps>(({ props, slots, onUnmounted }) => {
    const stats = useStatsContext();
    const axes = provideCarriedAxes(anatomy, 'item', () => ({ color: props.color }));
    const figures = signal({ count: 0 });
    defineProvide(useStatsItemContext, () => ({
        addFigure: () => {
            figures.count += 1;
            return () => {
                figures.count -= 1;
            };
        },
    }));
    const id = ++nextItemId;
    onUnmounted(stats.register(id));
    return () => {
        const own = partAxes(axes());
        return (
            <view
                {...partBag(anatomy, 'item', {
                    orientation: stats.orientation(),
                    ...own,
                    mods: { ...own.mods, first: stats.isFirst(id), figure: figures.count > 0 },
                    class: props.class,
                })}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Stats.Item' });

const band = (part: 'title' | 'value' | 'desc', name: string) =>
    component<StatsPartProps>(({ props, slots }) => {
        const axes = useVariantAxes();
        return () => (
            <text {...partBag(anatomy, part, { ...partAxes(axes()), class: props.class })}>
                {slots.default?.()}
            </text>
        );
    }, { name });

const StatsTitle = band('title', 'Stats.Title');
const StatsValue = band('value', 'Stats.Value');
const StatsDesc = band('desc', 'Stats.Desc');

const StatsFigure = component<StatsPartProps>(({ props, slots, onMounted, onUnmounted }) => {
    const item = useStatsItemContext();
    const axes = useVariantAxes();
    // Reported a microtask after mount: the item reads the count in its own
    // render, and a write made while that render is still running (a child
    // mounts inside it) would not re-run it.
    onUnmounted(joinAfterMount(onMounted, () => item.addFigure()));
    return () => (
        <view {...partBag(anatomy, 'figure', { ...partAxes(axes()), class: props.class })} accessibility-element={false}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Stats.Figure' });

export const Stats = compound(StatsRoot, {
    Root: StatsRoot,
    Item: StatsItem,
    Title: StatsTitle,
    Value: StatsValue,
    Desc: StatsDesc,
    Figure: StatsFigure,
});
