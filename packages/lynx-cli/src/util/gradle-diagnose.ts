/**
 * Turn a failed gradle run's output into one actionable message.
 *
 * Gradle's own failure text is often opaque to someone new to Android —
 * a JDK that's too new surfaces as a bare version string ("What went wrong:
 * 25.0.2"). We pull out the "What went wrong" block and match it (plus the
 * rest of the output) against known failure shapes, each with a concrete fix.
 */

import { GRADLE_WRAPPER_VERSION, supportedRangeLabel } from './jdk.js';

export interface GradleDiagnosis {
    /** What gradle said went wrong, condensed (first lines of the block). */
    reason: string | null;
    /** A concrete next step, when we recognise the failure. */
    hint: string | null;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/** Extract the `* What went wrong:` block from gradle output. */
export function extractWhatWentWrong(output: string): string | null {
    const text = output.replace(ANSI_RE, '').replace(/\r/g, '');
    const start = text.lastIndexOf('* What went wrong:');
    if (start === -1) return null;
    const rest = text.slice(start + '* What went wrong:'.length);
    const end = rest.search(/\n\* (Try|Exception is|Get more help|Where):|\nBUILD FAILED/);
    const block = (end === -1 ? rest : rest.slice(0, end))
        .split('\n')
        .map((l) => l.trimEnd())
        .filter((l) => l.trim() !== '');
    if (block.length === 0) return null;
    const MAX = 8;
    const lines = block.slice(0, MAX);
    if (block.length > MAX) lines.push('  …');
    return lines.join('\n').trim();
}

interface Rule {
    test: (reason: string, output: string) => boolean;
    hint: (ctx: DiagnoseContext, reason: string, output: string) => string;
}

export interface DiagnoseContext {
    applicationId?: string;
    /** Major version of the JDK gradle ran on, when known. */
    jdkMajor?: number;
}

const jdkHint = (ctx: DiagnoseContext): string =>
    `Gradle ${GRADLE_WRAPPER_VERSION} can't run on ${ctx.jdkMajor ? `JDK ${ctx.jdkMajor}` : 'this JDK'} — Android builds need JDK ${supportedRangeLabel()}.\n` +
    `  Point JAVA_HOME at Android Studio's bundled JDK (…/Android Studio/jbr) or another JDK ${supportedRangeLabel()},\n` +
    '  then re-run. `npx sigx doctor` shows which JDK sigx will use.';

const RULES: Rule[] = [
    {
        // Gradle's version parser throws with just the version string when
        // it doesn't know the JDK (e.g. "25.0.2").
        test: (reason, output) =>
            /^\d+(\.\d+)*([._+-][\w.]+)?$/.test(reason.trim()) ||
            /Unsupported class file major version|Unsupported Java|Could not determine java version|incompatible with the JVM|requires Java \d+/i.test(output),
        hint: (ctx) => jdkHint(ctx),
    },
    {
        test: (_r, output) => /INSTALL_FAILED_UPDATE_INCOMPATIBLE|signatures do not match/i.test(output),
        hint: (ctx) =>
            'An app with this package ID is already installed with a different signing key\n' +
            '  (common after switching machines or between debug/release builds).\n' +
            `  Fix:  adb uninstall ${ctx.applicationId ?? '<your application id>'}   — then re-run.`,
    },
    {
        test: (_r, output) => /No connected devices!|No online devices found/i.test(output),
        hint: () =>
            'No Android device or emulator is connected.\n' +
            '  Start an emulator (Android Studio → Device Manager) or plug in a phone with USB debugging on,\n' +
            '  then re-run. `npx sigx dev` can also boot an emulator for you.',
    },
    {
        test: (_r, output) => /SDK location not found/i.test(output),
        hint: () =>
            'Gradle could not find the Android SDK. Install it via Android Studio (SDK Manager),\n' +
            '  or set ANDROID_HOME to your SDK folder, then re-run.',
    },
    {
        test: (_r, output) => /licen[cs]es? (for the following SDK|have not been accepted)|not accepted the licen[cs]e|Licen[cs]e for package .* not accepted/i.test(output),
        hint: () =>
            'Some Android SDK licenses are not accepted yet. Run the SDK manager once to accept them:\n' +
            '  <ANDROID_HOME>/cmdline-tools/latest/bin/sdkmanager --licenses   (or open Android Studio → SDK Manager).',
    },
    {
        test: (_r, output) => /NDK (is not installed|not configured|at .* did not have a source\.properties)|No version of NDK matched/i.test(output),
        hint: () =>
            'The Android NDK is missing or incomplete. Install it from Android Studio → SDK Manager →\n' +
            '  SDK Tools → "NDK (Side by side)", then re-run.',
    },
    {
        test: (_r, output) => /INSTALL_FAILED_INSUFFICIENT_STORAGE/i.test(output),
        hint: () => 'The device is out of storage. Free up space, or wipe the emulator (Device Manager → Wipe Data).',
    },
    {
        test: (_r, output) => /Gradle build daemon disappeared|OutOfMemoryError|Java heap space|Metaspace/i.test(output),
        hint: () =>
            'Gradle ran out of memory or its daemon was killed. Close other heavy apps and re-run;\n' +
            '  if it keeps happening, raise org.gradle.jvmargs (-Xmx) in android/gradle.properties.',
    },
    {
        test: (_r, output) => /Could not (resolve|GET|HEAD|download)|UnknownHostException|Connection (timed out|refused)|PKIX path building failed/i.test(output),
        hint: () =>
            'Gradle could not download dependencies. Check your internet connection / proxy settings and re-run\n' +
            '  (the first Android build downloads a few hundred MB).',
    },
];

export function diagnoseGradleFailure(output: string, ctx: DiagnoseContext = {}): GradleDiagnosis {
    const clean = output.replace(ANSI_RE, '');
    const reason = extractWhatWentWrong(clean);
    for (const rule of RULES) {
        if (rule.test(reason ?? '', clean)) {
            return { reason, hint: rule.hint(ctx, reason ?? '', clean) };
        }
    }
    return { reason, hint: null };
}

/**
 * The message thrown when a gradle build fails.
 * `Android build failed: <reason>` + fix + where to see more.
 */
export function formatGradleFailure(diag: GradleDiagnosis, opts: { verbose?: boolean } = {}): string {
    const firstLine = diag.reason?.split('\n')[0]?.trim();
    const lines = [firstLine ? `Android build failed: ${firstLine}` : 'Android build failed'];
    if (diag.hint) {
        lines.push('');
        lines.push(`  ${diag.hint}`);
    }
    if (!opts.verbose) {
        lines.push('');
        lines.push('  Re-run with --verbose to see the full Gradle output.');
    }
    return lines.join('\n');
}
