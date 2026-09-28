/**
 * Navbar — the header bar: branding at one end, actions at the other, an
 * optional centre (zero's `navbar` scope).
 *
 * ```tsx
 * <Navbar.Root color="primary">
 *     <Navbar.Start><text>Acme</text></Navbar.Start>
 *     <Navbar.Center><text>Inbox</text></Navbar.Center>
 *     <Navbar.End><Button size="sm"><text>Sign in</text></Button></Navbar.End>
 * </Navbar.Root>
 * ```
 *
 * No states, no flags, no behavior: the bar is pure composition — three
 * optional sections on a row the skin lays out (start and end share the
 * slack, the centre hugs its content). The lynx spellings:
 *
 * - **Every part is a `view`.** Zero's root is a `<header>` (the banner
 *   landmark); lynx has no landmarks, and marking the root an accessibility
 *   element would hide its content from the reader on iOS, so the bar
 *   carries no accessibility props — each control inside it speaks for
 *   itself.
 * - **The axes ride every part.** `color` refills the whole bar with the
 *   role pair and `size` steps its height; both are stamped on the sections
 *   too (the lynx emitter narrows axis rules on the styled part itself), so
 *   a skin may colour a section with the bar.
 * - **Text inherits the bar's ink.** Put labels in `<text>`: the bar's
 *   `color` / `font-size` reach them through CSS inheritance.
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';

const anatomy = anatomies.navbar;

// ── Root ──

export type NavbarRootProps =
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const NavbarRoot = component<NavbarRootProps>(({ props, slots }) => {
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, {
        color: props.color, size: props.size,
    }));
    return () => (
        <view {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Navbar.Root' });

// ── Sections ──

export type NavbarSectionProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

function makeSection(part: 'start' | 'center' | 'end', name: string) {
    return component<NavbarSectionProps>(({ props, slots }) => {
        const axes = useVariantAxes();
        return () => (
            <view {...partBag(anatomy, part, { ...partAxes(axes()), class: props.class })}>
                {slots.default?.()}
            </view>
        );
    }, { name });
}

const NavbarStart = makeSection('start', 'Navbar.Start');
const NavbarCenter = makeSection('center', 'Navbar.Center');
const NavbarEnd = makeSection('end', 'Navbar.End');

export const Navbar = compound(NavbarRoot, {
    Root: NavbarRoot,
    Start: NavbarStart,
    Center: NavbarCenter,
    End: NavbarEnd,
});
