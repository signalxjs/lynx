/**
 * NavList — the navigation list an app shell's sidebar (or a drawer's
 * panel) is made of: groups of links, the current page marked, each link
 * with room for an icon and a trailing count.
 *
 * ```tsx
 * <NavList.Root color="primary">
 *     <NavList.Group>
 *         <NavList.Heading>Workspace</NavList.Heading>
 *         <NavList.List>
 *             <NavList.Item>
 *                 <NavList.Link current={route() === 'inbox'} onPress={() => nav.push('inbox')}>
 *                     <NavList.Icon><text>✉</text></NavList.Icon>
 *                     <text>Inbox</text>
 *                     <NavList.Meta><Badge>12</Badge></NavList.Meta>
 *                 </NavList.Link>
 *             </NavList.Item>
 *         </NavList.List>
 *     </NavList.Group>
 * </NavList.Root>
 * ```
 *
 * No behavior, as on the web: which link is current is the router's
 * knowledge, passed in as `current` (the `active` / `inactive` state pair).
 *
 * What the platform changes:
 * - **A link is a tap target, not an anchor.** There is no `href` to follow
 *   on lynx: `Link` emits `press` and the app navigates (lynx-navigation's
 *   `nav.push`, or any router). It is announced as a `link`, `selected`
 *   while current.
 * - **Press feel only.** The anatomy gives `link` no `pressed` flag (the web
 *   answers a pointer with `:hover`, which a touch platform drops), so a held
 *   link has the main-thread scale feel and no skin wash.
 * - **No landmark.** Lynx has no `navigation` role or `aria-labelledby`: the
 *   root and groups are plain views (marking a container an accessible
 *   element would hide its links from the reader on iOS), and a `Heading`
 *   is announced with the `header` trait.
 * - **Views, not lists.** `List` / `Item` are views in a column flow (the
 *   web's `<ul>`/`<li>` block boxes), so a link spans the list's width.
 * - **Not carried:** `asChild` on `Link` (no router anchor to merge into).
 */
import type { Define } from '@sigx/lynx';
import { component, compound } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';

const anatomy = anatomies['nav-list'];

/**
 * The web's list and list items are block boxes; a lynx `<view>` defaults
 * to `display: linear`. A flex column stretches the links across the list
 * the way block flow does (the Select lesson, #1167). Structural, not skin.
 */
const COLUMN = { display: 'flex', flexDirection: 'column' } as const;

// ── Root ──

export type NavListRootProps =
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const NavListRoot = component<NavListRootProps>(({ props, slots }) => {
    const axes = provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size }));
    return () => (
        <view {...partBag(anatomy, 'root', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </view>
    );
}, { name: 'NavList.Root' });

export type NavListPartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

/** A structural part: a view stamped with the root's axes. */
function viewPart(part: 'group' | 'list' | 'item' | 'icon' | 'meta', name: string, style?: Record<string, string>) {
    return component<NavListPartProps>(({ props, slots }) => {
        const axes = useVariantAxes();
        return () => (
            <view {...partBag(anatomy, part, { ...partAxes(axes()), class: props.class })} style={style}>
                {slots.default?.()}
            </view>
        );
    }, { name });
}

/** A section of the list ("Projects", "Settings"). */
const NavListGroup = viewPart('group', 'NavList.Group', COLUMN);
const NavListList = viewPart('list', 'NavList.List', COLUMN);
const NavListItem = viewPart('item', 'NavList.Item', COLUMN);
/** The link's leading glyph — a view: put a `<text>` glyph or an icon in it. */
const NavListIcon = viewPart('icon', 'NavList.Icon');
/** The trailing slot (a count `Badge`, a `Kbd` hint) — a view. */
const NavListMeta = viewPart('meta', 'NavList.Meta');

/** The group's name — a `<text>`, announced with the `header` trait. */
const NavListHeading = component<NavListPartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'heading', { ...partAxes(axes()), class: props.class })} {...partA11y({ trait: 'header' })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'NavList.Heading' });

// ── Link ──

export type NavListLinkProps =
    /** This is the page the user is on: `data-state="active"`, announced as selected. */
    & Define.Prop<'current', boolean, false>
    /** Accessible name, when the link's content is not plain text. */
    & Define.Prop<'label', string, false>
    /** `false` turns off the main-thread press feel. */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    /** The link was tapped — navigate here. */
    & Define.Event<'press'>
    & Define.Slot<'default'>;

const NavListLink = component<NavListLinkProps>(({ props, slots, emit }) => {
    const axes = useVariantAxes();
    // Tier 2 only in effect: the anatomy declares no `pressed` flag for a
    // link, so the flag this drives is never stamped.
    const press = createPressFeedback({ feel: props.pressFeel !== false });
    return () => {
        const current = !!props.current;
        return (
            <view
                {...partBag(anatomy, 'link', {
                    state: current ? 'active' : 'inactive',
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'link', label: props.label, selected: current })}
                bindtap={() => emit('press')}
                {...press.handlers}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'NavList.Link' });

export const NavList = compound(NavListRoot, {
    Root: NavListRoot,
    Group: NavListGroup,
    Heading: NavListHeading,
    List: NavListList,
    Item: NavListItem,
    Link: NavListLink,
    Icon: NavListIcon,
    Meta: NavListMeta,
});
