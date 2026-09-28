/**
 * Divider — a rule between things, zero's anatomy on lynx.
 *
 * ```tsx
 * <Divider />
 * <Divider orientation="vertical" />
 * <Divider.Root color="primary">
 *     <Divider.Label>or</Divider.Label>
 * </Divider.Root>
 * <Divider.Root>
 *     <Divider.Label placement="start">Billing</Divider.Label>
 * </Divider.Root>
 * ```
 *
 * On lynx the root IS the line (the skin's lynx rule, signalxjs/zero#375):
 * filled with the ink, one thickness across. The web draws a labelled
 * divider as two `::before`/`::after` segments around the Label, and lynx has
 * no pseudo-elements, so here lynx-zero draws those segments itself:
 *
 * - **Segments are real views.** While a Label is mounted the root renders a
 *   segment on each side of its children, carrying the root's own line
 *   classes (`zx-divider__root` + orientation + axes, plus the `segment`
 *   modifier), so each one paints exactly the rule an unlabelled divider
 *   paints — the same ink, thickness ramp and colour — and grows to fill its
 *   side, centred on the Label across the rule. They are decoration, not parts: no `data-scope`/`data-part`, not
 *   accessibility elements.
 * - **Placement is the missing segment.** A Label placed at `start` has no
 *   segment before it and one at `end` none after it, which is what the
 *   web's `:has(> [data-placement])::before { display: none }` says.
 * - **The labelled root stops being a line.** It is stamped `labelled` (the
 *   `zx-m-labelled` class) and its line geometry is lifted inline — auto
 *   cross size, no fill — so the Label and the segments lay out inside it.
 *
 * Accessibility: lynx has no separator role. An unlabelled divider is not an
 * accessibility element at all; a labelled one is read through its Label's
 * text. `decorative` is accepted for parity with zero (where it drops the
 * separator semantics) and changes nothing that lynx can express.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { axisClass, modClass, orientationClass, partClass } from '@sigx/zero/contract/core';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { joinAfterMount } from '../../shared/join-after-mount.js';

const anatomy = anatomies.divider;

type Orientation = 'horizontal' | 'vertical';

/** Where a Label sits on the rule; absent, it is centred. */
export type DividerLabelPlacement = 'start' | 'end';

interface DividerContext {
    orientation(): Orientation;
    /** A Label joins the root (mount order); returns the leave function. */
    register(placement: () => DividerLabelPlacement | undefined): () => void;
}

const useDividerContext = defineInjectable<DividerContext>(() => ({
    orientation: () => 'horizontal',
    register: () => () => {},
}));

/**
 * The class list of one line segment: the root's own line classes plus the
 * `segment` modifier — the pure half of the segment render, exported for
 * tests.
 */
export function dividerSegmentClass(orientation: Orientation, axes: VariantAxes): string {
    const classes = [partClass(anatomy.scope, 'root'), modClass('segment'), orientationClass(orientation)];
    for (const [axis, value] of Object.entries({ color: axes.color, size: axes.size, variant: axes.variant, ...axes.axes })) {
        if (value !== undefined) classes.push(axisClass(axis, value));
    }
    for (const [name, on] of Object.entries(axes.mods ?? {})) {
        if (on) classes.push(modClass(name));
    }
    return classes.join(' ');
}

/**
 * A segment grows to fill its side of the Label, centred on it across the
 * rule (#1272): the root's line classes carry `align-self: stretch`, and a
 * stretched segment with a definite thickness lands at cross-START on lynx —
 * the top of the label row, not the middle the web's `align-items: center`
 * gives the `::before`/`::after` rules.
 */
const SEGMENT_STYLE = { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, minHeight: 0, alignSelf: 'center' };

/**
 * The labelled root holds the Label and the segments instead of being the
 * line itself: its cross size follows its content and it has no fill.
 */
const LABELLED_STYLE: Record<Orientation, Record<string, string>> = {
    horizontal: { height: 'auto', backgroundColor: 'transparent', flexDirection: 'row' },
    vertical: { width: 'auto', backgroundColor: 'transparent', flexDirection: 'column' },
};

export type DividerRootProps =
    & Define.Prop<'orientation', Orientation, false>
    /** Zero parity: a purely visual rule. Lynx has no separator role to drop, so it changes nothing. */
    & Define.Prop<'decorative', boolean, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const DividerRoot = component<DividerRootProps>(({ props, slots }) => {
    const orientation = (): Orientation => props.orientation ?? 'horizontal';
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size }));
    // The mounted Labels' placements, replaced (never mutated) so a join or
    // a leave re-renders the root.
    const labels = signal({ list: [] as Array<{ id: number; placement: () => DividerLabelPlacement | undefined }> });
    let nextId = 0;
    defineProvide(useDividerContext, () => ({
        orientation,
        register: (placement) => {
            const id = ++nextId;
            labels.list = [...labels.list, { id, placement }];
            return () => {
                labels.list = labels.list.filter((entry) => entry.id !== id);
            };
        },
    }));

    return () => {
        const o = orientation();
        const a = axes();
        const first = labels.list[0];
        const labelled = first !== undefined;
        const placement = first?.placement();
        const rootAxes = partAxes(a);
        const segment = () => (
            <view class={dividerSegmentClass(o, a)} style={SEGMENT_STYLE} accessibility-element={false} />
        );
        return (
            <view
                {...partBag(anatomy, 'root', {
                    orientation: o,
                    ...rootAxes,
                    mods: { ...rootAxes.mods, labelled },
                    class: props.class,
                })}
                style={labelled ? LABELLED_STYLE[o] : undefined}
                accessibility-element={labelled ? undefined : false}
            >
                {labelled && placement !== 'start' ? segment() : null}
                {slots.default?.()}
                {labelled && placement !== 'end' ? segment() : null}
            </view>
        );
    };
}, { name: 'Divider.Root' });

export type DividerLabelProps =
    /** The edge the Label sits at; centred when absent. */
    & Define.Prop<'placement', DividerLabelPlacement, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const DividerLabel = component<DividerLabelProps>(({ props, slots, onMounted, onUnmounted }) => {
    const divider = useDividerContext();
    const axes = useVariantAxes();
    // Joined a microtask after mount: the root reads the Labels in its own
    // render, and a write made while that render is still running (a child
    // mounts inside it) would not re-run it.
    onUnmounted(joinAfterMount(onMounted, () => divider.register(() => props.placement)));
    return () => (
        <text
            {...partBag(anatomy, 'label', {
                placement: props.placement,
                orientation: divider.orientation(),
                ...partAxes(axes()),
                class: props.class,
            })}
        >
            {slots.default?.()}
        </text>
    );
}, { name: 'Divider.Label' });

export const Divider = compound(DividerRoot, { Root: DividerRoot, Label: DividerLabel });
