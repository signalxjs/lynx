/**
 * Pinned per-style components — ergonomic shortcuts around `<Icon set= name=>`
 * for the Font Awesome Free adapter. Set ids follow Font Awesome's own
 * prefix convention (the same strings FA uses in its CSS classes and JS
 * `IconPrefix` type):
 *
 * - `fas` — Solid (the default style most icons live in)
 * - `far` — Regular
 * - `fab` — Brands
 *
 * For these to resolve, the consumer's `signalx.config.ts` must declare a
 * matching `iconSets` entry, e.g.
 * `{ id: 'fas', source: '@sigx/lynx-icons-fa-free', styles: ['solid'] }`.
 * If a different id is used, the pinned components won't find their set —
 * fall back to the generic `<Icon set="…" name="…">` or write a one-line
 * local pin.
 *
 * Rendering still goes through `@sigx/lynx-icons`' `<Icon>`, so the
 * SVG/codepoint/missing-glyph branching, color sanitization, and theming
 * behavior is shared with the rest of the icons pipeline. These wrappers
 * only forward props.
 *
 * FA Pro styles (duotone, light, thin, sharp) are not shipped by FA Free;
 * Pro adapters would expose their own pinned components alongside these.
 */
import { component, type Define } from '@sigx/lynx';
import { Icon, type IconPropsExtensions } from '@sigx/lynx-icons';

type FaIconProps =
    & Define.Prop<'name', string, true>
    & Define.Prop<'size', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'class', string, false>
    /**
     * Inherit any theme-augmented props (e.g. daisy's `variant?: DaisyColor`).
     * The augmentation happens in core `@sigx/lynx-icons`'s
     * `IconPropsExtensions`; intersecting it here keeps the pinned
     * component's surface in sync without extra forwarding work.
     */
    & IconPropsExtensions;

/** Font Awesome **solid** icon — pins `set="fas"` to match FA's `IconPrefix`. */
export const FaSolidIcon = component<FaIconProps>(({ props }) => () => (
    // Spread forwards every prop including theme-augmented ones (no
    // explicit per-field listing needed). `set="fas"` after the spread
    // wins per JSX last-attr-wins semantics; `FaIconProps` doesn't
    // declare `set` so callers can't override.
    <Icon {...props} set="fas" />
));

/** Font Awesome **regular** (outlined) icon — pins `set="far"`. */
export const FaRegularIcon = component<FaIconProps>(({ props }) => () => (
    <Icon {...props} set="far" />
));

/** Font Awesome **brands** icon — pins `set="fab"`. */
export const FaBrandIcon = component<FaIconProps>(({ props }) => () => (
    <Icon {...props} set="fab" />
));
