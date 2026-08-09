/**
 * The two dev perf HUDs must show the same metrics, under the same names, in
 * the same order.
 *
 * That sounds like a style rule and isn't: before #978 Android rendered seven
 * hand-picked `LynxPerfMetric` fields while iOS rendered whatever string keys
 * the engine happened to put in its untyped timing dictionaries, so a number
 * read on one platform could not be compared to the other. The vocabulary is
 * now declared once per platform in native source — which means nothing but a
 * test stops it drifting apart again.
 *
 * Parsing native source from a JS test is unusual, so: it is the only place
 * both platforms meet. There is no shared native layer to put the list in, and
 * the alternative (noticing on a device, months later, that two numbers labelled
 * `Layout` measure different things) is worse.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const kotlinSource = readFileSync(
    new URL('../android/src/main/kotlin/com/sigx/devclient/PerfMetrics.kt', import.meta.url),
    'utf8',
);
const swiftSource = readFileSync(
    new URL('../ios/Sources/SigxDevClient/PerfMetrics.swift', import.meta.url),
    'utf8',
);

/** `const val FCP = "FCP"` → `{ FCP: 'FCP' }` */
function kotlinConstants(source: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [, name, value] of source.matchAll(/const val (\w+)\s*=\s*"([^"]*)"/g)) {
        out[name] = value;
    }
    return out;
}

/** `public static let fcp = "FCP"` → `{ fcp: 'FCP' }` */
function swiftConstants(source: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [, name, value] of source.matchAll(/static let (\w+)\s*=\s*"([^"]*)"/g)) {
        out[name] = value;
    }
    return out;
}

/**
 * Pull the ordered display list out of the declaration, resolving each entry
 * through the constants above. Reading the *list* rather than the constants
 * alone is what pins the order — two platforms can agree on every label and
 * still render them in a different sequence.
 */
function orderedKeys(
    source: string,
    declaration: RegExp,
    constants: Record<string, string>,
): string[] {
    const body = declaration.exec(source)?.[1];
    if (body === undefined) throw new Error('could not locate the ordered key list');
    return body
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
        .map((token) => {
            // Kotlin writes bare `FCP`; Swift writes bare `fcp` inside the enum.
            const name = token.replace(/^PerfVocabulary\./, '');
            const resolved = constants[name];
            if (resolved === undefined) throw new Error(`unresolved vocabulary entry: ${token}`);
            return resolved;
        });
}

const kotlinKeys = orderedKeys(
    kotlinSource,
    /val KEYS: List<String> = listOf\(([\s\S]*?)\)/,
    kotlinConstants(kotlinSource),
);
const swiftKeys = orderedKeys(
    swiftSource,
    /static let keys: \[String\] = \[([\s\S]*?)\]/,
    swiftConstants(swiftSource),
);

describe('the shared HUD vocabulary', () => {
    it('is non-trivial on both platforms', () => {
        // Guards the parser itself: a regex that silently matched nothing would
        // make every assertion below vacuously true.
        expect(kotlinKeys.length).toBeGreaterThan(5);
        expect(swiftKeys).toHaveLength(kotlinKeys.length);
    });

    it('renders the same labels in the same order on Android and iOS', () => {
        expect(swiftKeys).toEqual(kotlinKeys);
    });

    it('has no duplicate labels', () => {
        // The stores key on label, so a duplicate would silently collapse two
        // metrics into one line.
        expect(new Set(kotlinKeys).size).toBe(kotlinKeys.length);
    });

    it('covers the startup, render and memory groups', () => {
        // A rename that quietly dropped a group would still satisfy the parity
        // check above, since both platforms would drop it together.
        expect(kotlinKeys).toEqual(expect.arrayContaining(['FCP', 'FMP']));
        expect(kotlinKeys).toEqual(expect.arrayContaining(['Pipeline', 'Layout']));
        expect(kotlinKeys).toEqual(expect.arrayContaining(['Lynx mem', 'Nodes']));
    });
});
