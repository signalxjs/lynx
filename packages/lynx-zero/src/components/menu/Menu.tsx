/**
 * Menu — zero's menu button on lynx: a trigger, an anchored popup of
 * actions, and the stateful rows (checkbox and radio items) and submenus
 * the APG pattern adds.
 *
 * ```tsx
 * <Menu.Root onSelect={(v) => act(v)}>
 *     <Menu.Trigger><text>Actions</text></Menu.Trigger>
 *     <Menu.Popup>
 *         <Menu.Item value="rename"><text>Rename</text><Menu.Shortcut>⌘R</Menu.Shortcut></Menu.Item>
 *         <Menu.Separator />
 *         <Menu.CheckboxItem value="wrap" model={() => state.wrap}><text>Word wrap</text></Menu.CheckboxItem>
 *         <Menu.RadioGroup model={() => state.sort}>
 *             <Menu.GroupLabel>Sort by</Menu.GroupLabel>
 *             <Menu.RadioItem value="name"><text>Name</text></Menu.RadioItem>
 *         </Menu.RadioGroup>
 *         <Menu.Sub>
 *             <Menu.SubTrigger><text>Share</text></Menu.SubTrigger>
 *             <Menu.SubPopup><Menu.Item value="email"><text>Email</text></Menu.Item></Menu.SubPopup>
 *         </Menu.Sub>
 *     </Menu.Popup>
 * </Menu.Root>
 * ```
 *
 * The popup is Popover's machinery: the trigger measures itself, the popup
 * portals to the overlay outlet and positions from the shared placement
 * math (the RESOLVED side stamps as `data-placement`), its root opts back
 * into touches (`OVERLAY_ROOT_STYLE`), and the settle loop measures only
 * while the popup is open. A submenu is a second anchored popup, anchored
 * to its sub-trigger, in its own outlet entry (registered later, so it
 * paints on top) — the adapter's `portaled` option bridges both popups
 * back to their logical parent for the anatomy oracle.
 *
 * What the platform changes:
 * - **No keyboard.** Roving focus, typeahead, Home/End and the Arrow keys
 *   that open a submenu are the web's; activation here is a tap. A
 *   `focus-visible` flag is never set live — the gallery forces it.
 * - **The item under the finger is the highlighted one.** A touch list has
 *   no hover, so a held row stamps `highlighted` (the flag the skins paint
 *   their row wash on) together with `pressed`.
 * - **A sub-trigger opens on tap**, not on hover with intent delays, and
 *   the safe triangle has nothing to do. As on the web, one sub-chain is
 *   open per level: opening a submenu closes a sibling open beside it.
 * - **Light dismiss closes the chain.** A tap outside every open level (the
 *   root popup's transparent surface) closes the menu and every submenu,
 *   as the web's light dismiss does; a tap on the parent level's rows
 *   still reaches them. The dismiss stack (a back-button hook) closes the
 *   innermost level first.
 * - **Glyphs are `<text>`.** The web draws the item-indicator's ✓ and the
 *   sub-trigger's › with `::after`; lynx has no pseudo-elements, so they
 *   render as text children — the Select precedent.
 * - **Not rendered:** `arrow` (the position strategy computes no arrow
 *   offset on lynx) and `context-trigger` (a right-click surface; a
 *   long-press point anchor is a follow-up). The anatomy oracle walks
 *   rendered parts, so omission is legal. `keyshortcuts` is not carried:
 *   lynx has no `aria-keyshortcuts` to announce it through.
 *
 * Items take a `value` and never emit: runtime-core resolves a component's
 * handlers through `props.value` when one exists, so a `value`-carrying
 * component's `emit()` is a no-op. The ROOT emits `select`; a CheckboxItem
 * calls its own `onCheckedChange` handler directly (see there).
 */
import type { Define } from '@sigx/lynx';
import { component, compound, defineInjectable, defineProvide, effect, onUnmounted, untrack } from '@sigx/lynx';
import { anatomies } from '@sigx/zero/anatomy';
import type { ControllableState } from '@sigx/zero/behaviors/core';
import { createControllableState, createInertState } from '@sigx/zero/behaviors/core';
import { partBag } from '../../contract/part.js';
import { partA11y } from '../../contract/a11y.js';
import type { VariantAxes } from '../../contract/axes-context.js';
import { partAxes, provideVariantAxes, useVariantAxes } from '../../contract/axes-context.js';
import { resolveVariantAxes } from '../../contract/axis-defaults.js';
import { createPressFeedback } from '../../behaviors/press.js';
import { registerDismissLayer } from '../../behaviors/dismiss.js';
import type { LynxAnchorPosition, LynxPlacement } from '../../behaviors/position.js';
import { createAnchorPosition, useOutletFill } from '../../behaviors/position.js';
import { OVERLAY_ROOT_STYLE, PortalScope, useOverlayPortal } from '../../overlay/OverlayHost.js';

const anatomy = anatomies.menu;

/**
 * The web popup and group are block boxes, so their rows (and the
 * separator, which has no width of its own) span the list. A lynx `<view>`
 * defaults to `display: linear` and shrink-wraps them — the Select lesson
 * (#1167). Structural, not skin.
 */
const LIST_FLOW = { display: 'flex', flexDirection: 'column' } as const;

/**
 * The sub-trigger's chevron, the lynx spelling of the web's `::after` rule
 * (daisy: pushed to the reading end, faded to 0.6): a pseudo-element's box
 * has no class for a skin to select, so the geometry travels with the glyph.
 */
const CHEVRON_STYLE = { marginLeft: 'auto', opacity: 0.6 } as const;

/**
 * The narrowest a submenu gets to stay beside its trigger row (8rem, px) —
 * below that it slides over its parent instead (#1311). Wide enough for a
 * short label plus the chevron.
 */
const SUB_SHRINK_FLOOR = 128;

/** One open level of the menu — the root popup, or a submenu. */
interface MenuLevel {
    open(): boolean;
    setOpen(next: boolean): void;
    position: LynxAnchorPosition;
    placement(): LynxPlacement;
    /**
     * A child submenu of this level opened: it becomes the level's one open
     * child, and the sibling that held that slot closes (#1273).
     */
    childOpened(child: MenuLevel): void;
    /** A child submenu closed or unmounted: it gives the slot back. */
    childClosed(child: MenuLevel): void;
}

/**
 * The one-open-child slot a level keeps for its submenus. The web's menu
 * keeps one sub-chain open per level: opening a submenu closes any sibling
 * open beside it (Base UI's menu does this through its parent's active
 * index). Here the parent level holds the open child, so a sibling opening
 * by tap, `defaultOpen` or a two-way model closes the one before it.
 */
function createChildSlot(): Pick<MenuLevel, 'childOpened' | 'childClosed'> {
    let active: MenuLevel | null = null;
    return {
        childOpened: (child) => {
            const previous = active;
            active = child;
            if (previous && previous !== child) previous.setOpen(false);
        },
        childClosed: (child) => {
            if (active === child) active = null;
        },
    };
}

interface MenuContext extends MenuLevel {
    /** Emit the root's `select`, then close the chain per `closeOnSelect` (or the item's override). */
    select(value: string, closeOverride?: boolean): void;
}

const inertLevel = (): MenuLevel => ({
    open: () => false,
    setOpen: () => {},
    position: null as unknown as LynxAnchorPosition,
    placement: () => 'bottom-start',
    childOpened: () => {},
    childClosed: () => {},
});

const useMenuContext = defineInjectable<MenuContext | null>(() => null);
const useMenuSubContext = defineInjectable<MenuLevel | null>(() => null);

// ── Root ──

export type MenuRootProps =
    /** The popup's open state, two-way. */
    & Define.Model<boolean>
    & Define.Prop<'defaultOpen', boolean, false>
    & Define.Event<'openChange', boolean>
    /** An item (at any depth) was activated — its `value`. */
    & Define.Event<'select', string>
    /** Close the whole menu when a plain item is chosen (default true). */
    & Define.Prop<'closeOnSelect', boolean, false>
    & Define.Prop<'placement', LynxPlacement, false>
    & Define.Prop<'offset', number, false>
    & Define.Prop<'color', string, false>
    & Define.Prop<'size', string, false>
    & Define.Slot<'default'>;

const MenuRoot = component<MenuRootProps>(({ props, slots, emit }) => {
    const state = createControllableState<boolean>(
        () => props.model,
        props.defaultOpen ?? false,
        (value) => emit('openChange', value),
    );
    provideVariantAxes((): VariantAxes => resolveVariantAxes(anatomy.scope, { color: props.color, size: props.size }));
    const position = createAnchorPosition({
        placement: props.placement ?? 'bottom-start',
        offset: props.offset,
        isOpen: () => state.value,
        // A raised soft keyboard (a field elsewhere on the screen still
        // focused) trims the box the popup flips against (#1314).
        avoidKeyboard: true,
    });
    const ctx: MenuContext = {
        open: () => state.value,
        setOpen: (next) => {
            state.value = next;
        },
        position,
        placement: () => position.position()?.placement ?? props.placement ?? 'bottom-start',
        ...createChildSlot(),
        select: (value, closeOverride) => {
            emit('select', value);
            if (closeOverride ?? props.closeOnSelect ?? true) state.value = false;
        },
    };
    defineProvide(useMenuContext, () => ctx);
    // A Menu.Root nested inside another menu's popup is a menu of its own,
    // not a level of the outer one.
    defineProvide(useMenuSubContext, () => null);
    return () => slots.default?.();
}, { name: 'Menu.Root' });

// ── Trigger ──

export type MenuTriggerProps =
    & Define.Prop<'disabled', boolean, false>
    /** Accessible name, when the visible content is not text. */
    & Define.Prop<'label', string, false>
    /** `false` turns off the main-thread press feel (the pressed flag stays). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const MenuTrigger = component<MenuTriggerProps>(({ props, slots }) => {
    const menu = useMenuContext();
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled, feel: props.pressFeel !== false });
    return () => {
        const open = !!menu?.open();
        return (
            <view
                {...partBag(anatomy, 'trigger', {
                    state: open ? 'open' : 'closed',
                    flags: { disabled: disabled(), pressed: press.pressed() },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label, expanded: open, disabled: disabled() })}
                bindtap={() => {
                    if (!disabled() && menu) menu.setOpen(!menu.open());
                }}
                main-thread:ref={menu?.position.anchorRef}
                bindlayoutchange={menu?.position.anchorLayoutChange}
                {...press.handlers}
            >
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Menu.Trigger' });

// ── Popup ──

type PopupProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const MenuPopup = component<PopupProps>(({ props, slots }) => {
    const menu = useMenuContext();
    const axes = useVariantAxes();
    const portal = useOverlayPortal();
    const fill = useOutletFill();
    const bridge = (): void => {
        defineProvide(useMenuContext, () => menu);
        defineProvide(useMenuSubContext, () => null);
        provideVariantAxes(axes);
    };
    // Stable identities for PortalScope (the Popover lesson): a fresh arrow
    // per closure run would re-render the portaled subtree every outlet turn.
    const renderSlot = () => slots.default?.();
    let unregister: (() => void) | null = null;

    effect(() => {
        if (menu?.open()) {
            unregister ??= registerDismissLayer({ dismiss: () => menu.setOpen(false) });
            portal.show(() => (
                // A 0×0 root at the outlet's origin: it covers nothing, so a
                // pan beside the popup scrolls the page (#1190); it opts back
                // into lynx touches under the pass-through layer (#1180).
                <view style={{ ...OVERLAY_ROOT_STYLE, position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible' }}>
                    <view
                        // The transparent outside surface. A tap here closes
                        // the whole chain (the web's light dismiss); out of
                        // native hit-testing, so a pan scrolls the page.
                        native-interaction-enabled={false}
                        style={fill()}
                        bindtap={() => menu.setOpen(false)}
                        bindtouchstart={menu.position.track}
                        bindtouchmove={menu.position.track}
                        bindtouchend={menu.position.track}
                        bindtouchcancel={menu.position.track}
                    />
                    <view
                        {...partBag(anatomy, 'popup', {
                            state: 'open',
                            placement: menu.placement(),
                            ...partAxes(axes()),
                            class: props.class,
                        })}
                        style={{ ...LIST_FLOW, ...menu.position.style() }}
                        main-thread:ref={menu.position.floatingRef}
                        bindlayoutchange={menu.position.floatingLayoutChange}
                        catchtap={() => {}}
                    >
                        <PortalScope setup={bridge} render={renderSlot} />
                    </view>
                </view>
            ));
        } else {
            unregister?.();
            unregister = null;
            portal.hide();
        }
    });
    onUnmounted(() => unregister?.());

    return () => undefined;
}, { name: 'Menu.Popup' });

// ── Rows ──

/** The row a held finger is on: highlighted (the skins' wash) and pressed. */
function heldFlags(held: boolean): { highlighted: boolean; pressed: boolean } {
    return { highlighted: held, pressed: held };
}

export type MenuItemProps =
    /** What the root's `select` reports. */
    & Define.Prop<'value', string, true>
    & Define.Prop<'disabled', boolean, false>
    /** Accessible name, when the row's content is not plain text. */
    & Define.Prop<'label', string, false>
    /** `false` turns off the main-thread press feel (the flags stay). */
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const MenuItem = component<MenuItemProps>(({ props, slots }) => {
    const menu = useMenuContext();
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled, feel: props.pressFeel !== false });
    return () => (
        <view
            {...partBag(anatomy, 'item', {
                flags: { disabled: disabled(), ...heldFlags(press.pressed()) },
                ...partAxes(axes()),
                class: props.class,
            })}
            {...partA11y({ trait: 'button', label: props.label, disabled: disabled() })}
            bindtap={() => {
                if (!disabled()) menu?.select(props.value);
            }}
            {...press.handlers}
        >
            {slots.default?.()}
        </view>
    );
}, { name: 'Menu.Item' });

/** The mark well of a checkbox/radio row: always rendered, ✓ while checked. */
function indicator(checked: boolean, axes: VariantAxes) {
    return (
        <text {...partBag(anatomy, 'item-indicator', { state: checked ? 'checked' : 'unchecked', ...partAxes(axes) })}>
            {checked ? '✓' : ''}
        </text>
    );
}

export type MenuCheckboxItemProps =
    /** What the root's `select` reports. */
    & Define.Prop<'value', string, true>
    & Define.Model<boolean>
    & Define.Prop<'defaultChecked', boolean, false>
    & Define.Event<'checkedChange', boolean>
    /** Close the menu when this row toggles — default FALSE (unlike plain items). */
    & Define.Prop<'closeOnSelect', boolean, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'label', string, false>
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** The handler runtime-core would look up for `emit('checkedChange')`. */
type CheckedChangeHandler = { onCheckedChange?: (checked: boolean) => void };

const MenuCheckboxItem = component<MenuCheckboxItemProps>(({ props, slots }) => {
    const menu = useMenuContext();
    const axes = useVariantAxes();
    // `emit` is a no-op on a component with a `value` prop (runtime-core
    // resolves handlers through `props.value` when it exists), so the change
    // event calls the consumer's handler itself — the same lookup emit does.
    const checked = createControllableState<boolean>(
        () => props.model,
        props.defaultChecked ?? false,
        (next) => (props as unknown as CheckedChangeHandler).onCheckedChange?.(next),
    );
    const disabled = (): boolean => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled, feel: props.pressFeel !== false });
    return () => {
        const on = checked.value;
        return (
            <view
                {...partBag(anatomy, 'checkbox-item', {
                    state: on ? 'checked' : 'unchecked',
                    flags: { disabled: disabled(), ...heldFlags(press.pressed()) },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label, checked: on, disabled: disabled() })}
                bindtap={() => {
                    if (disabled()) return;
                    checked.value = !checked.value;
                    menu?.select(props.value, props.closeOnSelect ?? false);
                }}
                {...press.handlers}
            >
                {indicator(on, axes())}
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Menu.CheckboxItem' });

// ── Group / GroupLabel / RadioGroup / RadioItem ──

type PartProps = Define.Prop<'class', string, false> & Define.Slot<'default'>;

const MenuGroup = component<PartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <view {...partBag(anatomy, 'group', { ...partAxes(axes()), class: props.class })} style={LIST_FLOW}>
            {slots.default?.()}
        </view>
    );
}, { name: 'Menu.Group' });

/** The group's heading line — a `<text>`, so it takes a plain string. */
const MenuGroupLabel = component<PartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'group-label', { ...partAxes(axes()), class: props.class })} {...partA11y({ trait: 'header' })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'Menu.GroupLabel' });

interface RadioGroupContext {
    state: ControllableState<string>;
}

const useMenuRadioGroup = defineInjectable<RadioGroupContext>(() => ({ state: createInertState<string>('') }));

export type MenuRadioGroupProps =
    & Define.Model<string>
    & Define.Prop<'defaultValue', string, false>
    & Define.Event<'valueChange', string>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

/** One string model over a set of RadioItems; renders the `group` part. */
const MenuRadioGroup = component<MenuRadioGroupProps>(({ props, slots, emit }) => {
    const state = createControllableState<string>(
        () => props.model,
        props.defaultValue ?? '',
        (value) => emit('valueChange', value),
    );
    defineProvide(useMenuRadioGroup, () => ({ state }));
    return () => <MenuGroup class={props.class}>{slots.default?.()}</MenuGroup>;
}, { name: 'Menu.RadioGroup' });

export type MenuRadioItemProps =
    & Define.Prop<'value', string, true>
    /** Close the menu when this row is chosen — default FALSE, like CheckboxItem. */
    & Define.Prop<'closeOnSelect', boolean, false>
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'label', string, false>
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const MenuRadioItem = component<MenuRadioItemProps>(({ props, slots }) => {
    const menu = useMenuContext();
    const group = useMenuRadioGroup();
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled, feel: props.pressFeel !== false });
    return () => {
        const on = group.state.value === props.value;
        return (
            <view
                {...partBag(anatomy, 'radio-item', {
                    state: on ? 'checked' : 'unchecked',
                    flags: { disabled: disabled(), ...heldFlags(press.pressed()) },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label, checked: on, disabled: disabled() })}
                bindtap={() => {
                    if (disabled()) return;
                    group.state.value = props.value;
                    menu?.select(props.value, props.closeOnSelect ?? false);
                }}
                {...press.handlers}
            >
                {indicator(on, axes())}
                {slots.default?.()}
            </view>
        );
    };
}, { name: 'Menu.RadioItem' });

// ── Separator / Shortcut ──

const MenuSeparator = component<Define.Prop<'class', string, false>>(({ props }) => {
    const axes = useVariantAxes();
    return () => <view {...partBag(anatomy, 'separator', { ...partAxes(axes()), class: props.class })} />;
}, { name: 'Menu.Separator' });

/** The visible shortcut hint inside a row — decorative, a `<text>`. */
const MenuShortcut = component<PartProps>(({ props, slots }) => {
    const axes = useVariantAxes();
    return () => (
        <text {...partBag(anatomy, 'shortcut', { ...partAxes(axes()), class: props.class })}>
            {slots.default?.()}
        </text>
    );
}, { name: 'Menu.Shortcut' });

// ── Sub / SubTrigger / SubPopup ──

export type MenuSubProps =
    & Define.Model<boolean>
    & Define.Prop<'defaultOpen', boolean, false>
    & Define.Event<'openChange', boolean>
    /**
     * Where the submenu opens from its trigger (default `right-start`). It
     * flips when only the other side fits; when neither does it takes the
     * roomier side and narrows to the room beside its trigger row (down to
     * 8rem), and only slides back over the parent popup below that.
     */
    & Define.Prop<'placement', LynxPlacement, false>
    & Define.Prop<'offset', number, false>
    & Define.Slot<'default'>;

const MenuSub = component<MenuSubProps>(({ props, slots, emit }) => {
    // The level this submenu opens from: the submenu whose popup holds it,
    // or the root popup (whose bridge provides no sub level).
    const parent: MenuLevel | null = useMenuSubContext() ?? useMenuContext();
    const state = createControllableState<boolean>(
        () => props.model,
        props.defaultOpen ?? false,
        (value) => emit('openChange', value),
    );
    const position = createAnchorPosition({
        placement: props.placement ?? 'right-start',
        offset: props.offset ?? 0,
        // Two 13rem panels side by side outgrow a portrait phone: when
        // neither side fits, the submenu slides back over its parent rather
        // than running off-screen.
        shift: true,
        // …and before it slides, it narrows to the room beside its trigger
        // row (down to 8rem), so it never covers the parent's labels: a
        // nested submenu on a 402pt phone hid "Image" behind "nage" (#1311).
        shrinkTo: SUB_SHRINK_FLOOR,
        isOpen: () => state.value,
        // A raised soft keyboard (a field elsewhere on the screen still
        // focused) trims the box the popup flips against (#1314).
        avoidKeyboard: true,
    });
    const level: MenuLevel = {
        open: () => state.value,
        setOpen: (next) => {
            state.value = next;
        },
        position,
        placement: () => position.position()?.placement ?? props.placement ?? 'right-start',
        ...createChildSlot(),
    };
    // Siblings are mutually exclusive (#1273): an opening submenu claims its
    // parent's one child slot, which closes the sibling that held it. Every
    // way in counts: a tap, `defaultOpen`, or a model the app flips.
    effect(() => {
        const open = state.value;
        // Untracked: closing the sibling reads its state, which is not this
        // effect's dependency.
        untrack(() => (open ? parent?.childOpened(level) : parent?.childClosed(level)));
    });
    onUnmounted(() => parent?.childClosed(level));
    defineProvide(useMenuSubContext, () => level);
    return () => slots.default?.();
}, { name: 'Menu.Sub' });

export type MenuSubTriggerProps =
    & Define.Prop<'disabled', boolean, false>
    & Define.Prop<'label', string, false>
    & Define.Prop<'pressFeel', boolean, false>
    & Define.Prop<'class', string, false>
    & Define.Slot<'default'>;

const MenuSubTrigger = component<MenuSubTriggerProps>(({ props, slots }) => {
    const sub = useMenuSubContext() ?? inertLevel();
    const axes = useVariantAxes();
    const disabled = (): boolean => !!props.disabled;
    const press = createPressFeedback({ isDisabled: disabled, feel: props.pressFeel !== false });
    return () => {
        const open = sub.open();
        return (
            <view
                {...partBag(anatomy, 'sub-trigger', {
                    state: open ? 'open' : 'closed',
                    flags: { disabled: disabled(), ...heldFlags(press.pressed()) },
                    ...partAxes(axes()),
                    class: props.class,
                })}
                {...partA11y({ trait: 'button', label: props.label, expanded: open, disabled: disabled() })}
                bindtap={() => {
                    if (!disabled()) sub.setOpen(!sub.open());
                }}
                main-thread:ref={sub.position?.anchorRef}
                bindlayoutchange={sub.position?.anchorLayoutChange}
                {...press.handlers}
            >
                {slots.default?.()}
                <text style={CHEVRON_STYLE}>›</text>
            </view>
        );
    };
}, { name: 'Menu.SubTrigger' });

const MenuSubPopup = component<PopupProps>(({ props, slots }) => {
    const menu = useMenuContext();
    const sub = useMenuSubContext();
    const axes = useVariantAxes();
    const portal = useOverlayPortal();
    const bridge = (): void => {
        defineProvide(useMenuContext, () => menu);
        // Items inside are rows of THIS level; a Sub inside nests a level.
        defineProvide(useMenuSubContext, () => sub);
        provideVariantAxes(axes);
    };
    const renderSlot = () => slots.default?.();
    let unregister: (() => void) | null = null;

    effect(() => {
        if (sub?.open()) {
            // The back-button path closes the innermost level first.
            unregister ??= registerDismissLayer({ dismiss: () => sub.setOpen(false) });
            portal.show(() => (
                // No outside surface of its own: a tap outside every level
                // lands on the root popup's (closing the chain), and a tap
                // on the parent level's rows still reaches them.
                <view style={{ ...OVERLAY_ROOT_STYLE, position: 'absolute', top: 0, left: 0, width: 0, height: 0, overflow: 'visible' }}>
                    <view
                        {...partBag(anatomy, 'sub-popup', {
                            state: 'open',
                            placement: sub.placement(),
                            ...partAxes(axes()),
                            class: props.class,
                        })}
                        style={{ ...LIST_FLOW, ...sub.position.style() }}
                        main-thread:ref={sub.position.floatingRef}
                        bindlayoutchange={sub.position.floatingLayoutChange}
                        catchtap={() => {}}
                    >
                        <PortalScope setup={bridge} render={renderSlot} />
                    </view>
                </view>
            ));
        } else {
            unregister?.();
            unregister = null;
            portal.hide();
        }
    });
    onUnmounted(() => unregister?.());

    return () => undefined;
}, { name: 'Menu.SubPopup' });

export const Menu = compound(MenuRoot, {
    Root: MenuRoot,
    Trigger: MenuTrigger,
    Popup: MenuPopup,
    Item: MenuItem,
    CheckboxItem: MenuCheckboxItem,
    RadioGroup: MenuRadioGroup,
    RadioItem: MenuRadioItem,
    Group: MenuGroup,
    GroupLabel: MenuGroupLabel,
    Separator: MenuSeparator,
    Shortcut: MenuShortcut,
    Sub: MenuSub,
    SubTrigger: MenuSubTrigger,
    SubPopup: MenuSubPopup,
});
