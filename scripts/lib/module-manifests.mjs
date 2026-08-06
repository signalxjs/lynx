/**
 * module-manifests.mjs — cross-check each native module's method names across
 * the four places they're written down (CONVENTIONS.md C12):
 *
 *   JS call sites  →  signalx-module.json `ios.methods`  →  Swift `methodLookup`  →  Kotlin `@LynxMethod`
 *
 * Nothing validated this before. The autolinker serializes `ios.methods` into a
 * generated `register()` whose `methods: [String]` parameter is never read
 * (`packages/lynx-cli/src/autolink/ios.ts:223` and `:488-497`), so the field is
 * documentation — and it has already drifted four ways.
 *
 * Text-level and deliberately conservative: only method names that appear as a
 * string literal in a `callAsync`/`callSync` call are treated as called. A
 * dynamic name can't be resolved from text, and a checker that guesses is worse
 * than no checker.
 */

/**
 * Blank out comments, preserving offsets and line structure.
 *
 * JSDoc examples are full of realistic `callAsync(...)` snippets — core's own
 * `unwrapNative` docs show a Camera `takePicture` call — and counting those as
 * real call sites reports drift in the wrong package. Tracks string and
 * template literals so a `//` inside a URL isn't mistaken for a comment.
 */
export function stripComments(source) {
    let out = '';
    let i = 0;
    let state = 'code'; // code | line | block | single | double | template
    while (i < source.length) {
        const c = source[i];
        const next = source[i + 1];
        if (state === 'code') {
            if (c === '/' && next === '/') { state = 'line'; out += '  '; i += 2; continue; }
            if (c === '/' && next === '*') { state = 'block'; out += '  '; i += 2; continue; }
            if (c === "'") state = 'single';
            else if (c === '"') state = 'double';
            else if (c === '`') state = 'template';
            out += c; i += 1; continue;
        }
        if (state === 'line') {
            if (c === '\n') { state = 'code'; out += c; } else out += ' ';
            i += 1; continue;
        }
        if (state === 'block') {
            if (c === '*' && next === '/') { state = 'code'; out += '  '; i += 2; continue; }
            out += c === '\n' ? c : ' '; i += 1; continue;
        }
        // Inside a string: copy through, honouring escapes.
        if (c === '\\') { out += source.slice(i, i + 2); i += 2; continue; }
        if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) {
            state = 'code';
        }
        out += c; i += 1;
    }
    return out;
}

/** Method names passed as the second argument to callAsync/callSync. */
export function jsCalledMethods(source) {
    const names = new Set();
    // callAsync<T>(MODULE, 'method', …) — the module arg may be an identifier
    // or a literal; only the method name has to be literal.
    const re = /\bcall(?:Async|Sync)\s*(?:<[^>]*>)?\s*\(\s*[^,()]+,\s*(['"`])([A-Za-z_$][\w$]*)\1/g;
    for (const m of stripComments(source).matchAll(re)) names.add(m[2]);
    return names;
}

/** Keys of the Swift `methodLookup` dictionary. */
export function swiftLookupMethods(source) {
    const names = new Set();
    const block = source.match(/methodLookup\s*:\s*\[String\s*:\s*String\]\s*\{([\s\S]*?)\n\s*\}/);
    const body = block ? block[1] : source;
    for (const m of body.matchAll(/(['"])([A-Za-z_$][\w$]*)\1\s*:\s*NSStringFromSelector/g)) {
        names.add(m[2]);
    }
    return names;
}

/** Kotlin functions annotated `@LynxMethod`. */
export function kotlinMethods(source) {
    const names = new Set();
    for (const m of source.matchAll(/@LynxMethod[\s\S]{0,80}?\bfun\s+([A-Za-z_][\w]*)\s*\(/g)) {
        names.add(m[1]);
    }
    return names;
}

/**
 * Compare one module's four method sets.
 *
 * @param {object} mod
 * @param {string[]} mod.declared `ios.methods` from the manifest (empty if absent)
 * @param {Set<string>} mod.called method names found at JS call sites
 * @param {Set<string>} mod.swift keys of the Swift methodLookup (empty if no iOS source)
 * @param {Set<string>} mod.kotlin `@LynxMethod` functions (empty if no Android source)
 * @param {boolean} mod.hasIos whether the package ships iOS source
 * @param {boolean} mod.hasAndroid whether the package ships Android source
 */
export function checkModule(mod) {
    const violations = [];
    const declared = new Set(mod.declared);

    // Only meaningful when the manifest actually declares a method list —
    // several modules legitimately omit `ios.methods`.
    if (declared.size > 0) {
        for (const name of [...mod.called].sort()) {
            if (!declared.has(name)) {
                violations.push({
                    rule: 'C12/called-not-declared',
                    detail: `${name} — called from JS, absent from signalx-module.json ios.methods`,
                });
            }
        }
        for (const name of [...declared].sort()) {
            if (!mod.called.has(name)) {
                violations.push({
                    rule: 'C12/declared-not-called',
                    detail: `${name} — declared in ios.methods, never called from JS`,
                });
            }
        }
    }

    if (mod.hasIos && mod.swift.size > 0) {
        for (const name of [...mod.called].sort()) {
            if (!mod.swift.has(name)) {
                violations.push({
                    rule: 'C12/called-not-in-swift',
                    detail: `${name} — called from JS, absent from the Swift methodLookup`,
                });
            }
        }
    }

    if (mod.hasAndroid && mod.kotlin.size > 0) {
        for (const name of [...mod.called].sort()) {
            if (!mod.kotlin.has(name)) {
                violations.push({
                    rule: 'C12/called-not-in-kotlin',
                    detail: `${name} — called from JS, no @LynxMethod on the Android side`,
                });
            }
        }
    }

    return violations;
}
