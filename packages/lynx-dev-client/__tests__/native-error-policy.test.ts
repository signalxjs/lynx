/**
 * Which native Lynx errors raise the red-screen overlay is decided twice, once
 * per platform, in native source (#1252): an image that failed to load is an
 * expected state (the element fires `binderror`, the app shows its fallback),
 * so it is logged to the `sigx dev` terminal as a warning and kept off the red
 * screen, while every other error still raises it.
 *
 * There is no shared native layer to hold that rule, so, as with the perf HUD
 * vocabulary, this test reads both sources and holds them to the same rule:
 * the same Lynx resource-section codes, the check placed before the overlay
 * push, and the warning level on the terminal report.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const kotlin = readFileSync(
    new URL('../android/src/main/kotlin/com/sigx/devclient/DevLynxScreen.kt', import.meta.url),
    'utf8',
);
const swift = readFileSync(new URL('../ios/Sources/SigxDevClient/DevOverlays.swift', import.meta.url), 'utf8');
const kotlinReporter = readFileSync(
    new URL('../android/src/main/kotlin/com/sigx/devclient/DevServerReporter.kt', import.meta.url),
    'utf8',
);
const swiftReporter = readFileSync(
    new URL('../ios/Sources/SigxDevClient/DevServerReporter.swift', import.meta.url),
    'utf8',
);

/** The body of the native error callback, up to the next top-level member. */
function between(source: string, start: string, end: string): string {
    const from = source.indexOf(start);
    expect(from, `missing ${start}`).toBeGreaterThanOrEqual(0);
    const to = source.indexOf(end, from + start.length);
    expect(to, `missing ${end} after ${start}`).toBeGreaterThan(from);
    return source.slice(from, to);
}

describe('native error policy (#1252)', () => {
    it('both platforms classify the same Lynx resource section as recoverable images', () => {
        // Section 3xx is "Resource"; 301 is its image behavior.
        expect(swift).toMatch(/static let resourceErrorCodes = 300\.\.\.399/);
        expect(kotlin).toMatch(/RESOURCE_ERROR_CODES = 300\.\.399/);
        expect(swift).toMatch(/static let imageResourceErrorCode = 301/);
        expect(kotlin).toMatch(/IMAGE_RESOURCE_ERROR_CODE = 301/);
        expect(swift).toMatch(/static let imageResourceType = "image"/);
        expect(kotlin).toMatch(/IMAGE_RESOURCE_TYPE = "image"/);
        // Code 301, a 301xx sub-code, or an explicit image resource type.
        for (const src of [swift, kotlin]) {
            expect(src).toMatch(/subCode \/ 100 == (imageResourceErrorCode|IMAGE_RESOURCE_ERROR_CODE)/);
        }
    });

    it('iOS checks before the overlay and reports the image failure as a warning', () => {
        const body = between(swift, 'didRecieveError error: Error!)', 'static func isDevNoise');
        const check = body.indexOf('isRecoverableResourceError(error, message: message)');
        const overlay = body.indexOf('self.onError(message)');
        expect(check).toBeGreaterThan(0);
        expect(check).toBeLessThan(overlay);
        const branch = body.slice(check, body.indexOf('return', check));
        expect(branch).toContain('level: "warn"');
        expect(swiftReporter).toMatch(/"level": level/);
    });

    it('Android checks before the overlay and reports the image failure as a warning', () => {
        const body = between(kotlin, 'override fun onReceivedError', 'addLynxViewClientV2');
        const check = body.indexOf('isRecoverableResourceError(error)');
        const overlay = body.indexOf('pushError(msg)');
        expect(check).toBeGreaterThan(0);
        expect(check).toBeLessThan(overlay);
        const branch = body.slice(check, body.indexOf('return', check));
        expect(branch).toContain('level = "warn"');
        expect(kotlinReporter).toMatch(/\.put\("level", level\)/);
    });
});
