/**
 * EmptyState — what stands where the content would be (nothing yet, nothing
 * found, nothing reachable), zero's anatomy on lynx.
 *
 * ```tsx
 * <EmptyState.Root color="error">
 *     <EmptyState.Icon><text>⚠</text></EmptyState.Icon>
 *     <EmptyState.Title>Could not load your projects</EmptyState.Title>
 *     <EmptyState.Description>The server did not answer. Your work is saved.</EmptyState.Description>
 *     <EmptyState.Actions>
 *         <Button.Root onPress={retry}><text>Try again</text></Button.Root>
 *     </EmptyState.Actions>
 * </EmptyState.Root>
 * ```
 *
 * No state and no behaviour: presence is the consumer's `if`, and the way
 * out is the consumer's own buttons in `Actions`. The tone is the `color`
 * axis, the way Alert says it.
 *
 * What the platform changes:
 *
 * - **`Title` and `Description` are lynx `<text>`**, so they take a plain
 *   string and carry their own ink. Zero's `asChild` on the title (to make it
 *   a heading) has no lynx counterpart: there are no heading elements, so the
 *   title is announced as its text.
 * - **`Icon` is decorative** — not an accessibility element; the tone it
 *   paints is in the text. It is a view, so it holds a `<text>` glyph or an
 *   icon component.
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies['empty-state'];

export type EmptyStateRootProps =
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const EmptyStateRoot = component<EmptyStateRootProps>(({ props, slots }) => {
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size }));
    return () => (
        <view {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'EmptyState.Root' });

export type EmptyStatePartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const EmptyStateIcon = component<EmptyStatePartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'icon', { ...partAxes(axes()), class: props.class })} accessibility-element={false}>
            {slots.default?.()}
        </view>
    );
}, { name: 'EmptyState.Icon' });

const textPart = (part: 'title' | 'description', name: string) =>
    component<EmptyStatePartProps>(({ props, slots }) => {
        const axes = useVariantAxes();
        return () => (
            <text {...partBag(anatomy, part, { ...partAxes(axes()), class: props.class })}>
                {slots.default?.()}
            </text>
        );
    }, { name });

const EmptyStateTitle = textPart('title', 'EmptyState.Title');
const EmptyStateDescription = textPart('description', 'EmptyState.Description');

const EmptyStateActions = component<EmptyStatePartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'actions', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'EmptyState.Actions' });

export const EmptyState = compound(EmptyStateRoot, {
    Root: EmptyStateRoot,
    Icon: EmptyStateIcon,
    Title: EmptyStateTitle,
    Description: EmptyStateDescription,
    Actions: EmptyStateActions,
});
