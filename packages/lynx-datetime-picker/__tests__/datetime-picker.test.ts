/**
 * Unit tests for the JS-side date/time picker API. Mocks `@sigx/lynx-core`
 * so we never hit a real native module. Real UIDatePicker /
 * DatePickerDialog round-trip is exercised on-device via examples/showcase.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridge = {
    callAsync: vi.fn(async (..._args: unknown[]) => undefined as unknown),
    isModuleAvailable: vi.fn(() => true),
};

vi.mock('@sigx/lynx-core', () => ({
    callAsync: (...args: unknown[]) => bridge.callAsync(...(args as [])),
    isModuleAvailable: (...args: unknown[]) =>
        bridge.isModuleAvailable(...(args as [])),
}));

const { DateTimePicker } = await import('../src/datetime-picker.js');

beforeEach(() => {
    bridge.callAsync.mockClear();
    bridge.callAsync.mockImplementation(async () => ({ cancelled: true }));
    bridge.isModuleAvailable.mockReset();
    bridge.isModuleAvailable.mockReturnValue(true);
});

describe('DateTimePicker.pick', () => {
    it('sends options across the bridge as epoch milliseconds', async () => {
        const value = new Date(2026, 5, 7, 14, 30);
        const min = new Date(2020, 0, 1);
        const max = new Date(2030, 11, 31);
        await DateTimePicker.pick({
            mode: 'datetime',
            value,
            minimumDate: min,
            maximumDate: max,
            minuteInterval: 5,
            is24Hour: true,
            title: 'Pick',
        });
        expect(bridge.callAsync).toHaveBeenCalledWith('DateTimePicker', 'present', {
            mode: 'datetime',
            value: value.getTime(),
            minimumDate: min.getTime(),
            maximumDate: max.getTime(),
            minuteInterval: 5,
            is24Hour: true,
            title: 'Pick',
        });
    });

    it('defaults mode to "date" and drops absent optionals', async () => {
        await DateTimePicker.pick();
        expect(bridge.callAsync).toHaveBeenCalledWith('DateTimePicker', 'present', {
            mode: 'date',
        });
    });

    it('rehydrates a selection into a Date plus 1-based local components', async () => {
        const picked = new Date(2026, 5, 7, 14, 30); // June 7, local time
        bridge.callAsync.mockResolvedValueOnce({
            cancelled: false,
            value: picked.getTime(),
        });
        const result = await DateTimePicker.pick({ mode: 'datetime' });
        expect(result.cancelled).toBe(false);
        expect(result.value?.getTime()).toBe(picked.getTime());
        expect(result.year).toBe(2026);
        expect(result.month).toBe(6); // 1-based, unlike Date#getMonth
        expect(result.day).toBe(7);
        expect(result.hour).toBe(14);
        expect(result.minute).toBe(30);
    });

    it('returns { cancelled: true } with no components when dismissed', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: true });
        const result = await DateTimePicker.pick();
        expect(result).toEqual({ cancelled: true });
    });

    it('treats a malformed native payload as cancelled', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: false }); // no value
        const result = await DateTimePicker.pick();
        expect(result).toEqual({ cancelled: true });
    });

    it('treats a non-finite or out-of-range epoch value as cancelled', async () => {
        bridge.callAsync.mockResolvedValueOnce({ cancelled: false, value: NaN });
        expect(await DateTimePicker.pick()).toEqual({ cancelled: true });
        bridge.callAsync.mockResolvedValueOnce({ cancelled: false, value: Infinity });
        expect(await DateTimePicker.pick()).toEqual({ cancelled: true });
        bridge.callAsync.mockResolvedValueOnce({ cancelled: false, value: 8.65e15 }); // > max Date range
        expect(await DateTimePicker.pick()).toEqual({ cancelled: true });
    });

    it('drops Invalid Date options instead of sending NaN across the bridge', async () => {
        await DateTimePicker.pick({
            value: new Date(NaN),
            minimumDate: new Date(NaN),
        });
        expect(bridge.callAsync).toHaveBeenCalledWith('DateTimePicker', 'present', {
            mode: 'date',
        });
    });

    it('resolves to { cancelled: true } when module is not registered', async () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        const result = await DateTimePicker.pick();
        expect(result).toEqual({ cancelled: true });
        expect(bridge.callAsync).not.toHaveBeenCalled();
    });

    it('resolves to { cancelled: true } when the bridge rejects', async () => {
        bridge.callAsync.mockRejectedValueOnce(new Error('bridge exploded'));
        const result = await DateTimePicker.pick();
        expect(result).toEqual({ cancelled: true });
    });
});

describe('mode wrappers', () => {
    it.each([
        ['pickDate', 'date'],
        ['pickTime', 'time'],
        ['pickDateTime', 'datetime'],
    ] as const)('%s sets mode "%s"', async (method, mode) => {
        await DateTimePicker[method]({ is24Hour: true });
        expect(bridge.callAsync).toHaveBeenCalledWith('DateTimePicker', 'present', {
            mode,
            is24Hour: true,
        });
    });
});

describe('DateTimePicker.isModuleAvailable', () => {
    it('delegates to lynx-core', () => {
        bridge.isModuleAvailable.mockReturnValueOnce(false);
        expect(DateTimePicker.isModuleAvailable()).toBe(false);
        expect(bridge.isModuleAvailable).toHaveBeenCalledWith('DateTimePicker');
    });
});
