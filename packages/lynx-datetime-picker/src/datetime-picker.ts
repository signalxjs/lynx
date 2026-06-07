import { callAsync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'DateTimePicker';

export type DateTimePickerMode = 'date' | 'time' | 'datetime';

export interface DateTimePickerOptions {
    /** What to pick. Defaults to `'date'`. */
    mode?: DateTimePickerMode;
    /** Initial selection. Defaults to now (native side). */
    value?: Date;
    /** Earliest selectable instant. Ignored in `'time'` mode. */
    minimumDate?: Date;
    /** Latest selectable instant. Ignored in `'time'` mode. */
    maximumDate?: Date;
    /**
     * iOS only — `UIDatePicker.minuteInterval` (must evenly divide 60).
     * Android's `TimePickerDialog` has no equivalent; round the result on
     * the JS side if you need it there too.
     */
    minuteInterval?: number;
    /** 24-hour clock for time selection. Defaults to the device setting. */
    is24Hour?: boolean;
    /** Sheet title where the platform supports one (iOS). */
    title?: string;
}

export interface DateTimePickerResult {
    /** True when the user dismissed without choosing. */
    cancelled: boolean;
    /** Selected instant. Absent when cancelled. */
    value?: Date;
    /** Local calendar year of `value`. */
    year?: number;
    /** Local month of `value`, 1–12 (unlike `Date#getMonth`). */
    month?: number;
    /** Local day of month of `value`. */
    day?: number;
    /** Local hour of `value`, 0–23. */
    hour?: number;
    /** Local minute of `value`. */
    minute?: number;
}

/**
 * Options as sent across the bridge — all instants as epoch milliseconds.
 * A plain number is unambiguous (no timezone/offset parsing on the native
 * side) and round-trips losslessly through `Date`.
 */
interface NativeOptions {
    mode: DateTimePickerMode;
    value?: number;
    minimumDate?: number;
    maximumDate?: number;
    minuteInterval?: number;
    is24Hour?: boolean;
    title?: string;
}

interface NativeResult {
    cancelled: boolean;
    value?: number;
}

/** Convert JS options to the bridge shape, dropping absent optionals. */
function toNative(opts: DateTimePickerOptions): NativeOptions {
    const native: NativeOptions = { mode: opts.mode ?? 'date' };
    if (opts.value !== undefined) native.value = opts.value.getTime();
    if (opts.minimumDate !== undefined) native.minimumDate = opts.minimumDate.getTime();
    if (opts.maximumDate !== undefined) native.maximumDate = opts.maximumDate.getTime();
    if (opts.minuteInterval !== undefined) native.minuteInterval = opts.minuteInterval;
    if (opts.is24Hour !== undefined) native.is24Hour = opts.is24Hour;
    if (opts.title !== undefined) native.title = opts.title;
    return native;
}

/** Rehydrate the bridge result into a `Date` plus local components. */
function fromNative(result: NativeResult): DateTimePickerResult {
    // Non-finite epoch values would yield an Invalid Date with NaN
    // components — treat them as malformed, i.e. cancelled.
    if (result.cancelled || typeof result.value !== 'number' || !Number.isFinite(result.value)) {
        return { cancelled: true };
    }
    const value = new Date(result.value);
    return {
        cancelled: false,
        value,
        year: value.getFullYear(),
        month: value.getMonth() + 1,
        day: value.getDate(),
        hour: value.getHours(),
        minute: value.getMinutes(),
    };
}

/**
 * Native date/time picker — `UIDatePicker` presented in a sheet on iOS,
 * `DatePickerDialog` / `TimePickerDialog` on Android. `'datetime'` mode
 * shows a combined picker on iOS and chains date → time dialogs on Android.
 *
 * @example
 * ```ts
 * import { DateTimePicker } from '@sigx/lynx-datetime-picker';
 *
 * const result = await DateTimePicker.pickDate({
 *     value: current,
 *     minimumDate: new Date(2020, 0, 1),
 * });
 * if (!result.cancelled) {
 *     current = result.value;
 * }
 * ```
 */
// Closed-over rather than a method so the API survives destructuring
// (`const { pickDate } = DateTimePicker`) — no `this` dependence.
function pick(opts: DateTimePickerOptions = {}): Promise<DateTimePickerResult> {
    if (!isModuleAvailable(MODULE)) {
        return Promise.resolve({ cancelled: true });
    }
    return callAsync<NativeResult>(MODULE, 'present', toNative(opts))
        .then(fromNative)
        .catch(() => ({ cancelled: true }));
}

export const DateTimePicker = {
    /**
     * Present the picker. Always resolves — cancellation (and any bridge
     * failure) comes back as `{ cancelled: true }` rather than rejecting,
     * so call sites don't need try/catch around the common dismiss case.
     */
    pick,

    /** Pick a calendar date (`mode: 'date'`). */
    pickDate(opts: Omit<DateTimePickerOptions, 'mode'> = {}): Promise<DateTimePickerResult> {
        return pick({ ...opts, mode: 'date' });
    },

    /** Pick a time of day (`mode: 'time'`). */
    pickTime(opts: Omit<DateTimePickerOptions, 'mode'> = {}): Promise<DateTimePickerResult> {
        return pick({ ...opts, mode: 'time' });
    },

    /** Pick a combined date and time (`mode: 'datetime'`). */
    pickDateTime(opts: Omit<DateTimePickerOptions, 'mode'> = {}): Promise<DateTimePickerResult> {
        return pick({ ...opts, mode: 'datetime' });
    },

    /** Whether the native module is wired in the current build. */
    isModuleAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
