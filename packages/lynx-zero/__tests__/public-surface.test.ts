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
import type { LynxPartProps, ThemeController } from '../src/index';

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
                // ── lynx seams ──
                'partA11y',
                'partBag',
                // ── behaviors (portable re-exports + lynx implementations) ──
                'clearDismissLayers',
                'computeAnchorPosition',
                'createAnchorPosition',
                'createControllableState',
                'createId',
                'createListController',
                'createPressFeedback',
                'dismissTopLayer',
                'moveHighlight',
                'openLayerCount',
                'provideFieldContext',
                'registerDismissLayer',
                'segmentOptions',
                'useFieldContext',
                'useIdGenerator',
                'zeroPlugin',
                // ── overlays ──
                'OverlayHost',
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

    it('the controller keeps the legacy handle shape', () => {
        expectTypeOf(zero.themeController).toMatchTypeOf<ThemeController>();
        expectTypeOf<ThemeController['set']>().toBeFunction();
        expectTypeOf<ThemeController['fontScale']>().toBeNumber();
    });
});
