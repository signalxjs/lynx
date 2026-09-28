/**
 * Skeleton — the shape of what is coming (zero's `skeleton` scope).
 *
 * ```tsx
 * <Skeleton.Root model={() => state.pending}>
 *     <text>{article.title}</text>
 * </Skeleton.Root>
 * ```
 *
 * The model is `loading` and defaults to **true**: a skeleton is rendered
 * because something has not arrived yet. The children render in BOTH
 * states — holding the layout the content will occupy is the whole job, so
 * the page does not jump when the real thing arrives. The skin paints over
 * them while `loading` (a fill, the ink made transparent) and paints
 * nothing once `loaded`.
 *
 * What the platform changes:
 * - **No `aria-busy`.** Lynx has no live regions. While loading, the root
 *   is one accessible element announced as busy ("Loading", or `label`),
 *   which also keeps a reader out of the placeholder content. Loaded, it
 *   steps aside and the content is read as usual.
 * - **No `inert`.** The skin's `pointer-events: none` keeps taps off the
 *   placeholder content while loading.
 * - **The transparent ink reaches text by inheritance.** Lynx `<text>`
 *   inherits `color` only when the app enables CSS inheritance
 *   (`enableCSSInheritance`, as the showcase does). Without it, text inside
 *   a loading skeleton keeps its own ink.
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { createControllableState } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.skeleton;

export type SkeletonRootProps =
    & Define.Model<boolean>
    /** The uncontrolled start (default `true`: something is on its way). */
    & Define.Prop<'defaultLoading', boolean, false>
    & Define.Event<'loadingChange', boolean>
    /** What a reader hears while loading (default "Loading"). */
    & Define.Prop<'label', string, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const SkeletonRoot = component<SkeletonRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<boolean>(
        () => props.model,
        props.defaultLoading ?? true,
        (value) => emit('loadingChange', value),
    );
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));

    return () => {
        const loading = state.value;
        return (
            <view
                {...partBag(anatomy, 'root', { state: loading ? 'loading' : 'loaded', ...partAxes(axes()), class: props.class })}
                {...(loading ? { ...partA11y({ label: props.label ?? 'Loading' }), 'accessibility-status': 'busy' } : {})}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Skeleton.Root' });

// One part, but still a compound: every zero scope exports `<Pascal>.Root`.
export const Skeleton = compound(SkeletonRoot, { Root: SkeletonRoot });
