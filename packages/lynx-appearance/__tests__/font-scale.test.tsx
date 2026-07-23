/**
 * The OS font-scale surface moved to @sigx/lynx-core (#770) — behavior is
 * covered by lynx-core/__tests__/font-scale.test.ts. This package re-exports
 * it (appearance docs cover text-size); assert the re-export identity so a
 * future core rename can't silently fork the two surfaces.
 */
import { describe, it, expect } from 'vitest';
import * as appearance from '../src/index';
import * as core from '@sigx/lynx-core';

describe('font-scale re-exports from @sigx/lynx-core', () => {
  it('re-exports the same functions and constants', () => {
    expect(appearance.useFontScale).toBe(core.useFontScale);
    expect(appearance.useFontScaleMT).toBe(core.useFontScaleMT);
    expect(appearance.readGlobalFontScale).toBe(core.readGlobalFontScale);
    expect(appearance.FONT_SCALE_EVENT).toBe(core.FONT_SCALE_EVENT);
    expect(appearance.FONT_SCALE_GLOBAL_KEY).toBe(core.FONT_SCALE_GLOBAL_KEY);
  });
});
