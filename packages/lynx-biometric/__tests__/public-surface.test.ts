/**
 * Public-surface freeze test for @sigx/lynx-biometric.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. The type
 *    exports (`BiometricType`, `BiometricAvailability`, …) are erased at
 *    runtime and so are pinned below instead.
 *  - Types: the method signatures are pinned, because the shapes are what
 *    `CONVENTIONS.md` constrains and what silently breaks call sites when
 *    they drift.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as biometric from '../src/index';
import { Biometric } from '../src/index';
import type {
    BiometricAuthenticateOptions,
    BiometricAuthenticateResult,
    BiometricAvailability,
    BiometricErrorCode,
    BiometricType,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(biometric).sort()).toEqual(['Biometric']);
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(Biometric).sort()).toEqual(
            ['authenticate', 'isAvailable', 'isModuleAvailable'].sort(),
        );
    });
});

describe('public types', () => {
    it('pins isAvailable as it ships today (C2 drift, frozen not fixed)', () => {
        // C2 wants a capability probe to be synchronous; this one resolves a
        // richer `{ available, type }` payload from the native bridge instead,
        // which means `if (Biometric.isAvailable())` is always truthy. Frozen
        // as-is deliberately — the owning audit issue decides whether to
        // change it, and this assertion is what will fail loudly when it does.
        expectTypeOf(Biometric.isAvailable).toEqualTypeOf<() => Promise<BiometricAvailability>>();
        expectTypeOf<BiometricAvailability>().toEqualTypeOf<{
            available: boolean;
            type: BiometricType;
        }>();
    });

    it('pins authenticate as always-resolving with a coded result', () => {
        // The contract consumers rely on is that this never rejects: failures
        // (including user cancel) arrive as `{ success: false, errorCode }`,
        // so no call site wraps it in try/catch. Turning a rejection back on
        // would break every one of them without a type error at the call site.
        expectTypeOf(Biometric.authenticate).toEqualTypeOf<
            (opts: BiometricAuthenticateOptions) => Promise<BiometricAuthenticateResult>
        >();
        expectTypeOf<BiometricAuthenticateResult['errorCode']>().toEqualTypeOf<
            BiometricErrorCode | undefined
        >();
    });

    it('keeps the cancel/failure codes distinguishable (C5)', () => {
        // Call sites branch on these to tell "user backed out" from "no
        // hardware"; dropping or renaming a member silently collapses that
        // branch into the fallback path.
        expectTypeOf<'userCancel'>().toMatchTypeOf<BiometricErrorCode>();
        expectTypeOf<'userFallback'>().toMatchTypeOf<BiometricErrorCode>();
        expectTypeOf<'biometryNotEnrolled'>().toMatchTypeOf<BiometricErrorCode>();
    });

    it('keeps isModuleAvailable synchronous and boolean', () => {
        // The one genuinely synchronous probe here — used to gate UI before
        // any await, so a Promise return would make the gate always true.
        expectTypeOf(Biometric.isModuleAvailable).toEqualTypeOf<() => boolean>();
    });

    it('pins reason as the only required authenticate option', () => {
        // Making another field required would break existing call sites; the
        // native side treats the rest as platform-specific decoration.
        expectTypeOf<BiometricAuthenticateOptions>().toEqualTypeOf<{
            reason: string;
            title?: string;
            fallbackTitle?: string;
            allowDeviceCredential?: boolean;
        }>();
    });
});
