/**
 * #1275 — `sigx dev` forwards the log/reload WS port as well as the bundle
 * port on Android, so the dev client's device-error reports (posted to
 * `localhost:<wsPort>/__sigx/device-error`) reach the terminal.
 */
import { describe, expect, it } from 'vitest';
import { adbReverseDevPorts } from '../src/device-detect.js';

describe('adbReverseDevPorts', () => {
    it('forwards the bundle port and the log/WS port', () => {
        const calls: string[] = [];
        const ports = adbReverseDevPorts('emulator-5554', 8788, 8789, (id, p) => {
            calls.push(`${id}:${p}`);
            return true;
        });
        expect(calls).toEqual(['emulator-5554:8788', 'emulator-5554:8789']);
        expect(ports).toEqual([8788, 8789]);
    });

    it('reports only the forwards that succeeded, so teardown skips the rest', () => {
        const ports = adbReverseDevPorts('dev1', 8788, 8789, (_id, p) => p === 8788);
        expect(ports).toEqual([8788]);
    });

    it('forwards a shared port once', () => {
        const calls: number[] = [];
        adbReverseDevPorts('dev1', 9000, 9000, (_id, p) => { calls.push(p); return true; });
        expect(calls).toEqual([9000]);
    });
});
