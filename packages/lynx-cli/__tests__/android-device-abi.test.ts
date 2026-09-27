/**
 * #1170 — debug installs target the connected device's ABI (like Android
 * Studio's Run), and the "not enough space" install failure gets a hint.
 */
import { describe, expect, it } from 'vitest';
import { injectedBuildAbi, parseAbiList } from '../src/device-detect.js';
import { diagnoseGradleFailure } from '../src/util/gradle-diagnose.js';

describe('injectedBuildAbi', () => {
    it('passes the device ABI list, most preferred first', () => {
        expect(injectedBuildAbi([['arm64-v8a', 'armeabi-v7a', 'armeabi']])).toBe('arm64-v8a,armeabi-v7a,armeabi');
    });

    it('allows several devices that share a primary ABI', () => {
        expect(injectedBuildAbi([['x86_64', 'arm64-v8a'], ['x86_64']])).toBe('x86_64,arm64-v8a');
    });

    it('packages everything when devices disagree, one is unreadable, or none are connected', () => {
        expect(injectedBuildAbi([['arm64-v8a'], ['x86_64']])).toBeNull();
        expect(injectedBuildAbi([['arm64-v8a'], null])).toBeNull();
        expect(injectedBuildAbi([[]])).toBeNull();
        expect(injectedBuildAbi([])).toBeNull();
    });

    it('parses getprop output', () => {
        expect(parseAbiList('arm64-v8a,armeabi-v7a,armeabi\r\n')).toEqual(['arm64-v8a', 'armeabi-v7a', 'armeabi']);
        expect(parseAbiList('\n')).toEqual([]);
    });
});

describe('insufficient-storage diagnosis', () => {
    it('recognises the "Requested internal only, but not enough space" wording', () => {
        const output = [
            '* What went wrong:',
            "Execution failed for task ':app:installDebug' (registered by plugin 'com.android.internal.application').",
            '> java.util.concurrent.ExecutionException: com.android.builder.testing.api.DeviceException: com.android.ddmlib.InstallException: Unknown failure: Exception occurred while executing \'install\':',
            '  android.os.ParcelableException: java.io.IOException: Requested internal only, but not enough space',
        ].join('\n');
        const hint = diagnoseGradleFailure(output).hint;
        expect(hint).toContain('out of storage');
        expect(hint).toContain('Internal Storage');
    });

    it('still recognises the classic error code', () => {
        expect(diagnoseGradleFailure('Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]').hint).toContain('out of storage');
    });
});
