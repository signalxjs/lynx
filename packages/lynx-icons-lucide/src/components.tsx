/**
 * Pinned `LucideIcon` — ergonomic shortcut around `<Icon set="lucide" name=>`.
 * The `set` id is hard-coded to the conventional value (`'lucide'`)
 * documented in the README; consumers using a non-default set id should
 * fall back to the generic `<Icon>` or write their own one-line pin.
 *
 * Rendering still goes through `@sigx/lynx-icons`' `<Icon>`, so SVG
 * branching, color sanitization, and theming behavior is shared with the
 * rest of the icons pipeline. This wrapper only forwards props.
 */
import { component, type Define } from '@sigx/lynx';
import { Icon, type IconVariant } from '@sigx/lynx-icons';

type LucideIconProps =
    & Define.Prop<'name', string, true>
    & Define.Prop<'size', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'class', string, false>
    /** Variant resolved by `useIconVariantResolver` (daisy provides `primary` / `secondary` / …). */
    & Define.Prop<'variant', IconVariant, false>;

/** Lucide icon — pins `set="lucide"` so callers only specify the name. */
export const LucideIcon = component<LucideIconProps>(({ props }) => () => (
    <Icon
        set="lucide"
        name={props.name}
        size={props.size}
        color={props.color}
        class={props.class}
        variant={props.variant}
    />
));
