/**
 * AvatarGroup — a stack of avatars with a count for the ones left out
 * (zero's `avatar-group` scope).
 *
 * ```tsx
 * <AvatarGroup.Root label="Project members" size="sm">
 *     {shown.map((u) => (
 *         <Avatar.Root key={u.id}>
 *             <Avatar.Image src={u.photo} alt={u.name} />
 *             <Avatar.Fallback><text>{u.initials}</text></Avatar.Fallback>
 *         </Avatar.Root>
 *     ))}
 *     <AvatarGroup.Overflow count={members.length - shown.length} />
 * </AvatarGroup.Root>
 * ```
 *
 * Display-only: no model, no state. The consumer slices its own list and
 * passes what it left out as `count`.
 *
 * What the platform changes:
 * - **The group sizes its avatars itself.** The web recipe's `composes`
 *   (the group borrowing the avatar's own size step) has no class form on
 *   lynx, so the root pushes its resolved `size` and `color` down to every
 *   `Avatar.Root` inside it. An avatar's own `size` / `color` still wins.
 * - **The overlap is stamped.** Lynx has no `:first-child`, so the root
 *   tracks its avatars in mount order and stamps every one after the first
 *   `stacked` (`zx-m-stacked`, `data-mod-stacked`); the skin pulls those
 *   over their neighbour. An avatar mounted later joins the END of that
 *   order, wherever it sits in the row.
 * - **No group role.** Lynx has none. With a `label`, the root is one
 *   accessible element named by it, so a reader hears "Project members"
 *   once rather than every face. Without one, each avatar and the overflow
 *   chip are read on their own.
 *
 * `Overflow` shows "+N" and is announced as "N more" (`label` replaces
 * those words; translate them there). A `count` of zero or less renders
 * nothing, so `total - shown` needs no guard.
 */
import type { Define } from '@sigx/lynx';
import { component, compound, signal } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { avatarStacked, provideAvatarGroupSeam } from '../avatar/Avatar.js';

const anatomy = anatomies['avatar-group'];

// ── Root ──

export type AvatarGroupRootProps =
    /** The group's accessible name ("Project members"). */
    & Define.Prop<'label', string, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const AvatarGroupRoot = component<AvatarGroupRootProps>(({ props, slots }) => {
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));
    // The avatars in mount order, replaced (never mutated) so a join or a
    // leave re-renders the avatars that read it.
    const avatars = signal({ order: [] as number[] });
    provideAvatarGroupSeam({
        axes: () => {
            const a = axes();
            return { size: a.size, color: a.color };
        },
        register: (id) => {
            avatars.order = [...avatars.order, id];
            return () => {
                avatars.order = avatars.order.filter((other) => other !== id);
            };
        },
        stacked: (id) => avatarStacked(avatars.order, id),
    });

    return () => (
        <view
            {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}
            {...(props.label ? partA11y({ label: props.label }) : {})}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'AvatarGroup.Root' });

// ── Overflow ──

export type AvatarGroupOverflowProps =
    /** How many avatars the group leaves out. Zero or less renders nothing. */
    & Define.Prop<'count', number, true>
    /** What a reader hears instead of the visible "+N" (default "N more"). */
    & Define.Prop<'label', string, false>
    & Define.Prop<'class', string, false>;

const AvatarGroupOverflow = component<AvatarGroupOverflowProps>(({ props }) => {
    const axes = useVariantAxes();
    return () => {
        const count = Math.floor(props.count);
        if (!(count > 0)) return null;
        return (
            <view
                {...partBag(anatomy, 'overflow', { ...partAxes(axes()), class: props.class })}
                // Words, not a glyph a reader spells out as "plus three".
                {...partA11y({ label: props.label ?? `${count} more` })}
            >
                <text>{`+${count}`}</text>
            </view>
        );
    };
}, { name: 'AvatarGroup.Overflow' });

export const AvatarGroup = compound(AvatarGroupRoot, {
    Root: AvatarGroupRoot,
    Overflow: AvatarGroupOverflow,
});
