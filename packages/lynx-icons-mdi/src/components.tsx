/**
 * Pinned `MdiIcon` — ergonomic shortcut around `<Icon set="mdi" name=>`.
 * The `set` id is hard-coded to the conventional value (`'mdi'`)
 * documented in the README; consumers using a non-default set id should
 * fall back to the generic `<Icon>` or write their own one-line pin.
 *
 * Rendering still goes through `@sigx/lynx-icons`' `<Icon>`, so SVG
 * branching, color sanitization, and theming behavior is shared with the
 * rest of the icons pipeline. This wrapper only forwards props.
 */
import { component, type Define } from '@sigx/lynx';
import { Icon, type IconPropsExtensions } from '@sigx/lynx-icons';

type MdiIconProps =
    & Define.Prop<'name', string, true>
    & Define.Prop<'size', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'class', string, false>
    /** Follow the OS text-size setting — see `IconProps.scaleWithText`. */
    & Define.Prop<'scaleWithText', boolean, false>
    /**
     * Inherit any theme-augmented props (e.g. daisy's `variant?: DaisyColor`).
     * Sourced from core `IconPropsExtensions` so the pinned component's
     * surface stays in sync without explicit forwarding.
     */
    & IconPropsExtensions;

/** Material Design icon — pins `set="mdi"` so callers only specify the name. */
export const MdiIcon = component<MdiIconProps>(({ props }) => () => (
    // Spread forwards every prop (including theme-augmented). `set="mdi"`
    // after the spread wins; MdiIconProps doesn't declare `set` so
    // callers can't override the pin.
    <Icon {...props} set="mdi" />
));
