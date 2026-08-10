/**
 * Public-surface freeze test for @sigx/lynx-datetime-picker.
 *
 * Locks the package's exported API so accidental removals or renames break CI
 * rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-navigation/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect (the three
 *    exported types are erased and deliberately absent from that list).
 *  - Types: the load-bearing signatures are pinned, because those shapes are
 *    what `CONVENTIONS.md` constrains — the availability check has to stay
 *    synchronous (C2), and `DateTimePickerResult` is the cancellable-result
 *    shape (C5) every call site branches on.
 *
 * This freezes today's surface; it does not correct it. The C2 naming
 * deviation below is recorded for the package's audit issue, not fixed here.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as datetimePicker from '../src/index.js';
import { DateTimePicker } from '../src/index.js';
import type { DateTimePickerOptions, DateTimePickerResult } from '../src/index.js';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(datetimePicker).sort()).toEqual(['DateTimePicker', 'formatDate'].sort());
    });

    it('exposes exactly the documented methods', () => {
        // A new method reaching consumers unannounced is the thing this
        // catches; the README API table has to grow with it.
        expect(Object.keys(DateTimePicker).sort()).toEqual(
            ['isModuleAvailable', 'pick', 'pickDate', 'pickDateTime', 'pickTime'].sort(),
        );
    });
});

describe('public types', () => {
    it('pins the picker signatures', () => {
        // `pick` takes the full options; the three convenience wrappers fix
        // `mode` themselves, so it must stay un-passable on them.
        expectTypeOf(DateTimePicker.pick).toEqualTypeOf<
            (opts?: DateTimePickerOptions) => Promise<DateTimePickerResult>
        >();
        expectTypeOf(DateTimePicker.pickDate).toEqualTypeOf<
            (opts?: Omit<DateTimePickerOptions, 'mode'>) => Promise<DateTimePickerResult>
        >();
        expectTypeOf(DateTimePicker.pickTime).toEqualTypeOf<typeof DateTimePicker.pickDate>();
        expectTypeOf(DateTimePicker.pickDateTime).toEqualTypeOf<typeof DateTimePicker.pickDate>();
    });

    it('keeps the availability check synchronous and boolean (C2)', () => {
        // The convention most worth freezing: `Biometric.isAvailable()`
        // drifted into returning a Promise, which makes
        // `if (mod.isAvailable())` silently always true. Note the name here is
        // `isModuleAvailable`, not the C2-mandated `isAvailable` — frozen as
        // shipped, flagged for the audit issue.
        expectTypeOf(DateTimePicker.isModuleAvailable).toEqualTypeOf<() => boolean>();
        expectTypeOf(DateTimePicker.isModuleAvailable()).not.toEqualTypeOf<Promise<boolean>>();
    });

    it('keeps `cancelled` on the result and the selection optional (C5)', () => {
        // Every call site branches on `cancelled` and then reads `value`;
        // making `value` non-optional (or dropping `cancelled`) would silently
        // invert those guards.
        expectTypeOf<DateTimePickerResult>().toHaveProperty('cancelled').toEqualTypeOf<boolean>();
        expectTypeOf<DateTimePickerResult>().toHaveProperty('value').toEqualTypeOf<
            Date | undefined
        >();
    });

    it('pins formatDate as null-tolerant (C-independent, but load-bearing)', () => {
        // Accepting `undefined | null` is what lets consumers render a
        // cancelled result without a guard; narrowing the parameter would
        // break every such call site.
        expectTypeOf(datetimePicker.formatDate).toEqualTypeOf<
            (date: Date | undefined | null, pattern: string) => string
        >();
    });
});
