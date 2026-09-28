/**
 * Badge — a small standing label (a count, a status, a tag), zero's `badge`
 * anatomy on lynx.
 *
 * ```tsx
 * <Badge color="success"><text>Active</text></Badge>
 * <Badge.Root>
 *     <Badge.Dot color="warning" running />
 *     <text>Deploying</text>
 * </Badge.Root>
 * ```
 *
 * The root carries the axes and is the pill: a `view` (lynx prints text only
 * inside `<text>`, so the label is a `<text>` child — the skin's ink and type
 * size reach it by CSS inheritance). No state, no behavior, and no `asChild`:
 * lynx has no element to merge a bag onto, so a pressable badge is a Badge
 * inside the pressable.
 *
 * `Badge.Dot` is the status dot (zero#130). It RE-CARRIES the colour axis
 * (the anatomy's `carries: ['color']`, zero#94): a dot with a `color` of its
 * own is that colour; without one it follows the pill's (the nearest
 * carrier wins), and on an uncoloured pill it is the pill's ink. Lynx CSS
 * has no descendant selector, so the winning value is STAMPED on the dot
 * (`provideCarriedAxes`), exactly like Timeline's marker. `running` is the
 * one state — the thing the pill names is in flight. The dot is decorative:
 * the pill's text is the label, so it is not an accessible element.
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideCarriedAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.badge;

export type BadgeRootProps =
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'variant', string, false>
    & Define.Prop<'class', string, false>
    /**
     * Accessible name, when the visible text is not the whole story (a bare
     * count: `label="3 unread"`). Unset, the reader reads the label text.
     */
    & Define.Prop<'label', string, false>
    & Define.Slot<'default'>;

const BadgeRoot = component<BadgeRootProps>(({ props, slots }) => {
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size, variant: props.variant,
    }));
    return () => (
        <view
            {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}
            // A named badge is one accessible element; an unnamed one lets
            // the reader reach its text directly (no empty stop around it).
            {...(props.label ? partA11y({ label: props.label }) : {})}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Badge.Root' });

/** The dot takes the scope's colour vocabulary for itself — its own value outranks the pill's. */
export type BadgeDotProps =
    & Define.Prop<'color', string, false>
    /** The thing the pill names is in flight: stamps the `running` state. */
    & Define.Prop<'running', boolean, false>
    & Define.Prop<'class', string, false>;

const BadgeDot = component<BadgeDotProps>(({ props }) => {
    const axes = provideCarriedAxes(anatomy, 'dot', () => ({ color: props.color }));
    return () => (
        <view
            {...partBag(anatomy, 'dot', {
                state: props.running ? 'running' : undefined,
                ...partAxes(axes()),
                class: props.class,
            })}
            accessibility-element={false}
        />
    );
}, { name: 'Badge.Dot' });

export const Badge = compound(BadgeRoot, { Root: BadgeRoot, Dot: BadgeDot });
