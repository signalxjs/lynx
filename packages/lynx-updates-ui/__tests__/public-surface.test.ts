/**
 * Public-surface freeze test for @sigx/lynx-updates-ui.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The
 *    `*Props` types are erased at runtime and are pinned below instead.
 *  - Types: the load-bearing shapes only. This package ships no native module,
 *    so `CONVENTIONS.md` C2/C6/C7 don't apply; what a consumer can silently
 *    break here is the prop/event/slot contract of the four components and the
 *    dismissal helpers' async shape.
 *
 * Note: this package is pure UI with no `.web.ts` sibling — the platform split
 * lives in `@sigx/lynx-updates` — so there is no web-parity block (D7.1b).
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as updatesUi from '../src/index';
import type {
    UpdateApplyOn,
    UpdateGateProps,
    UpdateProgressProps,
    UpdatePromptProps,
    UpdateReadyBannerProps,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(updatesUi).sort()).toEqual(
            [
                // Components
                'UpdateGate',
                'UpdatePrompt',
                'UpdateProgress',
                'UpdateReadyBanner',
                // Dismissal persistence — public because apps re-implementing
                // the prompt still need to honour "don't ask again".
                'isDismissed',
                'dismiss',
                'DISMISSED_KEY_PREFIX',
            ].sort(),
        );
    });

    it('keeps the storage key prefix stable', () => {
        // The prefix is the on-device schema: changing it silently resurrects
        // every update the user already dismissed.
        expect(updatesUi.DISMISSED_KEY_PREFIX).toBe('__sigx_updates_dismissed:');
    });
});

describe('public types', () => {
    it('pins the dismissal helpers as async and id-keyed', () => {
        // Both swallow storage failures and resolve rather than reject, so
        // callers may `void dismiss(id)`; a signature that started throwing or
        // went synchronous would break that at every call site at once.
        expectTypeOf(updatesUi.isDismissed).toEqualTypeOf<(id: string) => Promise<boolean>>();
        expectTypeOf(updatesUi.dismiss).toEqualTypeOf<(id: string) => Promise<void>>();
        // Frozen as-is, not endorsed: the declared type is a widened `string`
        // rather than the literal, so nothing type-level stops a consumer from
        // reassigning-through or building keys from a different prefix. The
        // value itself is asserted in the runtime block above.
        expectTypeOf(updatesUi.DISMISSED_KEY_PREFIX).toEqualTypeOf<string>();
    });

    it('pins the apply-timing union', () => {
        // Dropping or renaming a member changes what `<UpdatePrompt applyOn>`
        // accepts; 'next-launch' is the default and the safe path.
        expectTypeOf<UpdateApplyOn>().toEqualTypeOf<'restart' | 'next-launch'>();
        expectTypeOf<UpdatePromptProps['applyOn']>().toEqualTypeOf<UpdateApplyOn | undefined>();
    });

    it('keeps every component prop optional', () => {
        // All four components are drop-in — `<UpdateGate>` with no props is
        // valid usage. A newly required prop is a breaking change for every
        // existing mount site, and typechecks fine inside this package.
        expectTypeOf<Record<string, never>>().toMatchTypeOf<UpdateGateProps>();
        expectTypeOf<Record<string, never>>().toMatchTypeOf<UpdatePromptProps>();
        expectTypeOf<Record<string, never>>().toMatchTypeOf<UpdateProgressProps>();
        expectTypeOf<Record<string, never>>().toMatchTypeOf<UpdateReadyBannerProps>();
    });

    it('pins the gate slots — content plus the blocked-screen escape hatch', () => {
        // `blocked` is the documented way to replace the built-in mandatory
        // overlay; losing the slot silently falls back to the built-in UI
        // instead of erroring at the fill site.
        expectTypeOf<UpdateGateProps['__slots']>().not.toBeNever();
        type SlotNames = keyof NonNullable<UpdateGateProps['__slots']>;
        expectTypeOf<SlotNames>().toEqualTypeOf<'default' | 'blocked'>();
    });

    it('pins the dismiss events on the prompt and the banner', () => {
        // Both surface a user "not now"; the event is how apps record their own
        // telemetry or restore surrounding chrome.
        expectTypeOf<UpdatePromptProps>().toHaveProperty('dismiss');
        expectTypeOf<UpdateReadyBannerProps>().toHaveProperty('dismiss');
    });
});
