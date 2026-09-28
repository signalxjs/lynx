/**
 * Public-surface freeze test for @sigx/lynx-zero — present from the
 * package's FIRST commit, closing its share of the #857 carve-out at birth
 * (the legacy stack was exempted while this redesign was in flight; the
 * redesign does not inherit the exemption).
 *
 * Locks the exported API so an accidental removal or rename breaks CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update the snapshot here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * A large slice of this surface is re-exported verbatim from
 * `@sigx/zero/contract/core` — the zero contract itself (vocabularies,
 * token machinery, the class grammar). Pinning it HERE is deliberate: a
 * zero beta bump that adds or removes contract exports changes this
 * package's public surface, and this test is what makes that visible in
 * review instead of silent.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as zero from '../src/index';
import type { LynxPartProps, ThemeController, ToastStatus, Toaster } from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(zero).sort()).toEqual(
            [
                // ── zero contract re-exports (@sigx/zero/contract/core) ──
                'BASE_SURFACE_TOKEN_LIST',
                'CLASS_GRAMMAR_VERSION',
                'CSS_COLOR_KEYWORDS',
                'FLAG_VOCABULARY',
                'HOST_CLASS',
                'MOD_ATTR_PREFIX',
                'PLACEMENT_VOCABULARY',
                'RECOMMENDED_ROLE_LIST',
                'RESERVED_AXES',
                'ROLE_NAME_PATTERN',
                'SIZE_SCALE_LIST',
                'STATE_NAMES',
                'STATE_SYNONYMS',
                'STATE_VOCABULARY',
                'TEXT_FIXED_PREFIX',
                'TOKEN_CATEGORIES',
                'TOKEN_KEY_PATTERN',
                'VARIANT_AXES',
                'axisClass',
                'cssVar',
                'dataAttr',
                'defaultSwatch',
                'defineAnatomy',
                'flagClass',
                'modClass',
                'orientationClass',
                'partClass',
                'placementClass',
                'resolveColorToken',
                'stateAttr',
                'stateClass',
                'themeClass',
                'token',
                'tokenProperty',
                'variantAttrs',
                // added by zero 0.3 / 0.4 (the layout vocabulary, axis-value
                // grammar, reserved data attrs, event/prop helpers)
                'AXIS_VALUE_PATTERN',
                'BASE_BREAKPOINT_KEY',
                'LAYOUT_ATTR_NAMES',
                'LAYOUT_ATTR_PREFIX',
                'LAYOUT_VOCABULARY',
                'RESERVED_DATA_ATTRS',
                'SPACE_STEPS',
                'changeEventOf',
                'defaultPropOf',
                'htmlAttrs',
                'isLayoutValue',
                'layoutAttrSpec',
                'layoutAttrs',
                'layoutClass',
                'parseLayoutAttr',
                // ── lynx seams ──
                'partA11y',
                'partBag',
                // ── behaviors (portable re-exports + lynx implementations) ──
                'clearDismissLayers',
                'computeAnchorPosition',
                'computeOutletPosition',
                'computeOverlayInsets',
                'containedFrame',
                'createAnchorPosition',
                'fixedOutletRect',
                'provideOverlayOrigin',
                'toOutletCoordinates',
                'useOutletFill',
                'useOverlayInsets',
                'createCollection',
                'createControllableState',
                'createId',
                'createListController',
                'createPressFeedback',
                'PRESSED_OPACITY',
                'PRESSED_SCALE',
                'defaultItemKey',
                'defaultItemLabel',
                'dismissTopLayer',
                'moveHighlight',
                'openLayerCount',
                'provideFieldContext',
                'registerDismissLayer',
                'segmentBy',
                'useFieldContext',
                'useIdGenerator',
                'zeroPlugin',
                // ── components (pilot wave 1) ──
                'Accordion',
                'Button',
                'Progress',
                'Switch',
                'Tabs',
                // ── axis push-down ──
                'partAxes',
                'provideCarriedAxes',
                'provideVariantAxes',
                'registerAxisDefaults',
                'resolveVariantAxes',
                'useVariantAxes',
                // ── components (pilot wave 2 — overlays) ──
                'Dialog',
                'Popover',
                'Toast',
                'createToaster',
                'provideToaster',
                // ── components (pilot wave 3 — composites) ──
                'Select',
                'Slider',
                // ── components (zero#94 — a part that re-carries an axis) ──
                'Timeline',
                // ── components (zero wave 2 — forms: W2D, #1202) ──
                'Fieldset',
                'NUMBER_INPUT_SPIN_INTERVAL',
                'NumberInput',
                // ── components (Wave 2, forms — #1204) ──
                'Toggle',
                'ToggleGroup',
                // ── components (zero wave 2 — forms, #1203) ──
                'Checkbox',
                'CheckboxGroup',
                'RadioGroup',
                // ── components (zero wave 2 — text fields, W2C #1205) ──
                'Field',
                'Input',
                'Textarea',
                // ── components (zero wave 3 — display: alert, card, W3B #1235) ──
                'Alert',
                'Card',
                // ── components (zero wave 3 — display, W3A #1234) ──
                'Badge',
                'Kbd',
                'Status',
                // ── components (zero wave 3 — display: W3D, #1236) ──
                'Divider',
                'EmptyState',
                'Stats',
                // ── components (zero wave 3 — display, W3C #1237) ──
                'Avatar',
                'AvatarGroup',
                'Skeleton',
                'Spinner',
                // ── components (zero wave 4 — navigation, W4B #1257) ──
                'Breadcrumbs',
                'Navbar',
                'breadcrumbsHidden',
                // ── components (zero wave 4 — navigation, W4A #1259) ──
                'Menu',
                'NavList',
                // ── overlays ──
                'OVERLAY_ROOT_STYLE',
                'OverlayHost',
                'PortalScope',
                'ZeroRoot',
                'hasOverlayHost',
                'useOverlayPortal',
                // ── theme engine ──
                'ThemeProvider',
                'getTheme',
                'listThemes',
                'makeThemeController',
                'normalizeFontScale',
                'pairOf',
                'pickThemeFor',
                'registerTextRamp',
                'registerTheme',
                'registerThemes',
                'textRampVars',
                'themeController',
                'useTheme',
                // ── layout ──
                'Center',
                'Col',
                'Row',
                'ScrollView',
                'Spacer',
                'resolveBoxStyle',
                'resolveResponsive',
                'resolveSpacing',
            ].sort(),
        );
    });
});

describe('load-bearing signatures', () => {
    it('partBag derives classes and data attrs from one descriptor', () => {
        expectTypeOf(zero.partBag).parameter(1).toBeString();
        expectTypeOf(zero.partBag).returns.toMatchTypeOf<LynxPartProps>();
    });

    it('NumberInput and Fieldset are compounds with the zero parts', () => {
        expectTypeOf(zero.NumberInput.Root).toBeFunction();
        expectTypeOf(zero.NumberInput.Label).toBeFunction();
        expectTypeOf(zero.NumberInput.Control).toBeFunction();
        expectTypeOf(zero.NumberInput.Input).toBeFunction();
        expectTypeOf(zero.NumberInput.IncrementTrigger).toBeFunction();
        expectTypeOf(zero.NumberInput.DecrementTrigger).toBeFunction();
        expectTypeOf(zero.NUMBER_INPUT_SPIN_INTERVAL).toBeNumber();
        expectTypeOf(zero.Fieldset.Root).toBeFunction();
        expectTypeOf(zero.Fieldset.Legend).toBeFunction();
    });

    it('Alert and Card are compounds with the zero parts (#1235)', () => {
        expectTypeOf(zero.Alert.Root).toBeFunction();
        expectTypeOf(zero.Alert.Icon).toBeFunction();
        expectTypeOf(zero.Alert.Title).toBeFunction();
        expectTypeOf(zero.Alert.Description).toBeFunction();
        expectTypeOf(zero.Alert.Close).toBeFunction();
        expectTypeOf(zero.Card.Root).toBeFunction();
        expectTypeOf(zero.Card.Media).toBeFunction();
        expectTypeOf(zero.Card.Header).toBeFunction();
        expectTypeOf(zero.Card.Title).toBeFunction();
        expectTypeOf(zero.Card.Description).toBeFunction();
        expectTypeOf(zero.Card.Body).toBeFunction();
        expectTypeOf(zero.Card.Footer).toBeFunction();
    });

    it('Badge, Status and Kbd are compounds with the zero parts', () => {
        expectTypeOf(zero.Badge.Root).toBeFunction();
        expectTypeOf(zero.Badge.Dot).toBeFunction();
        expectTypeOf(zero.Status.Root).toBeFunction();
        expectTypeOf(zero.Kbd.Root).toBeFunction();
    });

    it('Divider, Stats and EmptyState are compounds with the zero parts (W3D, #1236)', () => {
        expectTypeOf(zero.Divider.Root).toBeFunction();
        expectTypeOf(zero.Divider.Label).toBeFunction();
        for (const part of ['Root', 'Item', 'Title', 'Value', 'Desc', 'Figure'] as const) {
            expect(typeof zero.Stats[part], `Stats.${part}`).toBe('function');
        }
        for (const part of ['Root', 'Icon', 'Title', 'Description', 'Actions'] as const) {
            expect(typeof zero.EmptyState[part], `EmptyState.${part}`).toBe('function');
        }
    });

    it('the W3C display compounds carry the zero parts; toasts carry promise + status (#1196)', () => {
        expectTypeOf(zero.Avatar.Root).toBeFunction();
        expectTypeOf(zero.Avatar.Image).toBeFunction();
        expectTypeOf(zero.Avatar.Fallback).toBeFunction();
        expectTypeOf(zero.AvatarGroup.Root).toBeFunction();
        expectTypeOf(zero.AvatarGroup.Overflow).toBeFunction();
        expectTypeOf(zero.Skeleton.Root).toBeFunction();
        expectTypeOf(zero.Spinner.Root).toBeFunction();
        expectTypeOf(zero.Toast.Indicator).toBeFunction();
        expectTypeOf<Toaster['promise']>().toBeFunction();
        expectTypeOf<Toaster['update']>().toBeFunction();
        expectTypeOf<ToastStatus>().toEqualTypeOf<'loading' | 'complete' | 'error'>();
    });

    it('Menu and NavList are compounds with the zero parts (W4A, #1259)', () => {
        for (const part of [
            'Root', 'Trigger', 'Popup', 'Item', 'CheckboxItem', 'RadioGroup', 'RadioItem', 'Group', 'GroupLabel',
            'Separator', 'Shortcut', 'Sub', 'SubTrigger', 'SubPopup',
        ] as const) {
            expect(typeof zero.Menu[part], `Menu.${part}`).toBe('function');
        }
        for (const part of ['Root', 'Group', 'Heading', 'List', 'Item', 'Link', 'Icon', 'Meta'] as const) {
            expect(typeof zero.NavList[part], `NavList.${part}`).toBe('function');
        }
    });

    it('the controller keeps the legacy handle shape', () => {
        expectTypeOf(zero.themeController).toMatchTypeOf<ThemeController>();
        expectTypeOf<ThemeController['set']>().toBeFunction();
        expectTypeOf<ThemeController['fontScale']>().toBeNumber();
    });
});
