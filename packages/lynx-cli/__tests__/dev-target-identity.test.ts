/**
 * `DataTable` uses `identity` to break sort ties and to keep the cursor on the
 * same row across re-renders, so a collision makes the selection jump between
 * devices. Labels collide in ordinary setups; the underlying ids do not.
 */
import { describe, it, expect } from 'vitest';
import { targetIdentity } from '../src/dev-shell';
import type { SelectedTarget } from '../src/target-picker';

describe('targetIdentity', () => {
    it('separates two devices that report the same model', () => {
        // The case that motivated this: two Pixel 8s on one desk. Their
        // labels are identical; their adb ids are not.
        const a: SelectedTarget = { kind: 'android-device', deviceId: 'emulator-5554', model: 'Pixel 8' };
        const b: SelectedTarget = { kind: 'android-device', deviceId: 'RFCT80ABCDE', model: 'Pixel 8' };
        expect(targetIdentity(a)).not.toBe(targetIdentity(b));
    });

    it('separates two iOS targets that share a name', () => {
        const sim: SelectedTarget = { kind: 'ios-simulator', udid: 'AAAA-1111', name: 'iPhone 15', needsBoot: false };
        const dev: SelectedTarget = { kind: 'ios-device', udid: 'BBBB-2222', name: 'iPhone 15' };
        expect(targetIdentity(sim)).not.toBe(targetIdentity(dev));
    });

    it('never lets two kinds collide even on an identical underlying id', () => {
        // Contrived, but the prefix is what makes it impossible rather than
        // unlikely — udid and avd namespaces are unrelated.
        const sim: SelectedTarget = { kind: 'ios-simulator', udid: 'X1', name: 'A', needsBoot: false };
        const dev: SelectedTarget = { kind: 'ios-device', udid: 'X1', name: 'A' };
        expect(targetIdentity(sim)).not.toBe(targetIdentity(dev));
    });

    it('is stable for the same target', () => {
        const t: SelectedTarget = { kind: 'android-avd', avdName: 'Pixel_7_API_34' };
        expect(targetIdentity(t)).toBe(targetIdentity({ ...t }));
    });

    it('covers every target kind', () => {
        const all: SelectedTarget[] = [
            { kind: 'android-device', deviceId: 'd1' },
            { kind: 'android-avd', avdName: 'a1' },
            { kind: 'ios-simulator', udid: 'u1', name: 'n1', needsBoot: true },
            { kind: 'ios-device', udid: 'u2', name: 'n2' },
        ];
        const ids = all.map(targetIdentity);
        expect(new Set(ids).size).toBe(all.length);
        expect(ids.every((id) => id.length > 0)).toBe(true);
    });
});
