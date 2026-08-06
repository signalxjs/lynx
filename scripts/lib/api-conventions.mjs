/**
 * api-conventions.mjs — the mechanically-checkable parts of the module API
 * contract in CONVENTIONS.md (C1–C12).
 *
 * These are text-level rules, not type-level ones: they read `src/index.ts`,
 * the package sources and the README, and they are deliberately conservative.
 * A rule that needs the type checker to be correct doesn't belong here — it
 * belongs in the package's public-surface freeze test (rubric D7.1).
 *
 * ## Why a baseline
 *
 * The contract was written *from* the packages, so on day one most rules have
 * violations — 149 `throw`s exist and 7 carry the required prefix. A gate that
 * fails on all of them can't be merged, and a gate that reports without failing
 * is ignored. So this is a ratchet: `api-conventions-baseline.json` records
 * what was already wrong, CI fails on anything *new*, and a baseline entry
 * that is no longer needed is itself an error — which is what makes each
 * module audit shrink the file instead of leaving it to rot.
 */

/** Package directories exempt from C1's namespace rule, per CONVENTIONS.md. */
export const WEB_STANDARD_MIRRORS = new Set(['lynx-http', 'lynx-websocket', 'lynx-webrtc']);

const THROW_RE = /throw new (?:Error|TypeError|RangeError)\(\s*(['"`])/g;
const PREFIXED_THROW_RE = /throw new (?:Error|TypeError|RangeError)\(\s*(['"`])\[@sigx\//g;

/**
 * C2 — a bare `isAvailable` exported from the package barrel.
 *
 * Bare because it collides: `lynx-appearance` and `lynx-sqlite` both export one
 * today, so a consumer importing both barrels gets whichever wins. Free-function
 * packages must export `is<Cap>Available()` instead.
 *
 * Matches an `isAvailable` identifier in an export clause or an
 * `export function isAvailable` declaration — not `X.isAvailable` on a
 * namespace object, which is the correct form.
 */
export function findBareIsAvailable(indexSource) {
    const hits = [];
    // export { a, isAvailable, b } from './x.js'  /  export { isAvailable }
    for (const m of indexSource.matchAll(/export\s*\{([^}]*)\}/g)) {
        const names = m[1]
            .split(',')
            .map((s) => s.trim().split(/\s+as\s+/).pop().trim())
            .filter(Boolean);
        if (names.includes('isAvailable')) hits.push('export { … isAvailable … }');
    }
    if (/export\s+(?:async\s+)?function\s+isAvailable\b/.test(indexSource)) {
        hits.push('export function isAvailable');
    }
    return hits;
}

/**
 * C2 — `isAvailable` that returns a Promise.
 *
 * `isAvailable` answers "is the native module linked?" and is always
 * synchronous. `Biometric.isAvailable(): Promise<BiometricAvailability>` asks a
 * different question (is the hardware enrolled?), so `if (mod.isAvailable())`
 * gets a truthy Promise and proceeds as though the module were present.
 * A capability check belongs under a different name.
 */
export function findAsyncIsAvailable(source) {
    const hits = [];
    for (const m of source.matchAll(/\bisAvailable\s*\([^)]*\)\s*:\s*Promise\s*</g)) {
        hits.push(m[0].replace(/\s+/g, ' ').trim());
    }
    if (/\basync\s+isAvailable\s*\(/.test(source)) hits.push('async isAvailable(');
    return hits;
}

/**
 * C6 — a package implementing the permission pair must re-export
 * `PermissionResponse` from its barrel, so consumers can type their own state
 * without a second import from core.
 */
export function needsPermissionReexport(sources, indexSource) {
    const implementsPair = sources.some(
        (s) => /\brequestPermission\s*\(/.test(s) && /\bgetPermissionStatus\s*\(/.test(s),
    );
    if (!implementsPair) return false;
    return !/\bPermissionResponse\b/.test(indexSource);
}

/**
 * C10 — count `throw new Error(...)` whose message does not open with the
 * `[@sigx/<pkg>]` prefix.
 *
 * Counted per package rather than listed per site: 142 of 149 throws are
 * unprefixed today, and a 142-entry baseline would be noise nobody reads. The
 * count is enough to catch a package getting worse.
 *
 * Only literal-message throws are counted — a rethrow or a computed message
 * can't be checked from text alone, and guessing would make the gate lie.
 */
export function countUnprefixedThrows(source) {
    const total = [...source.matchAll(THROW_RE)].length;
    const prefixed = [...source.matchAll(PREFIXED_THROW_RE)].length;
    return total - prefixed;
}

/** C11 — a native module's README must state its web story. */
export function missingWebSection(readme) {
    return !/^##\s+Web\b/m.test(readme);
}

/**
 * Run every rule over one package.
 *
 * @param {object} pkg
 * @param {string} pkg.dir package directory name, e.g. `lynx-camera`
 * @param {string} pkg.indexSource contents of `src/index.ts` ('' if absent)
 * @param {Array<{path: string, source: string}>} pkg.sources all `src` files
 * @param {string} pkg.readme contents of `README.md` ('' if absent)
 * @param {boolean} pkg.isNativeModule whether it has a `signalx-module.json`
 * @returns {Array<{rule: string, detail: string}>} violations, rule ids stable
 *          because the baseline keys on them
 */
export function checkPackage(pkg) {
    const violations = [];
    const allSource = pkg.sources.map((s) => s.source).join('\n');

    for (const hit of findBareIsAvailable(pkg.indexSource)) {
        violations.push({ rule: 'C2/bare-is-available', detail: hit });
    }

    for (const hit of findAsyncIsAvailable(allSource)) {
        violations.push({ rule: 'C2/async-is-available', detail: hit });
    }

    if (needsPermissionReexport(pkg.sources.map((s) => s.source), pkg.indexSource)) {
        violations.push({
            rule: 'C6/permission-response-not-reexported',
            detail: 'implements requestPermission/getPermissionStatus but the barrel does not re-export PermissionResponse',
        });
    }

    const unprefixed = countUnprefixedThrows(allSource);
    if (unprefixed > 0) {
        violations.push({
            rule: 'C10/unprefixed-throws',
            detail: String(unprefixed),
            count: unprefixed,
        });
    }

    if (pkg.isNativeModule && missingWebSection(pkg.readme)) {
        violations.push({ rule: 'C11/readme-missing-web-section', detail: 'no `## Web` section' });
    }

    return violations;
}

/**
 * Compare findings against the baseline.
 *
 * Three outcomes, all of them failures — a ratchet that only tightens:
 *  - `added`   a violation the baseline doesn't cover, or a count that grew
 *  - `stale`   a baseline entry for something now fixed (lower or drop it)
 *  - `unknown` a baseline entry for a package that no longer exists
 *
 * @param {Record<string, Array<{rule: string, detail: string, count?: number}>>} found
 * @param {Record<string, Array<{rule: string, count?: number}>>} baseline
 */
export function diffAgainstBaseline(found, baseline) {
    const added = [];
    const stale = [];
    const unknown = [];

    for (const [pkg, violations] of Object.entries(found)) {
        const allowed = baseline[pkg] ?? [];
        for (const v of violations) {
            const match = allowed.find((a) => a.rule === v.rule);
            if (!match) {
                added.push({ pkg, ...v });
            } else if (typeof v.count === 'number' && typeof match.count === 'number' && v.count > match.count) {
                added.push({ pkg, ...v, detail: `${v.count} (baseline allows ${match.count})` });
            }
        }
    }

    for (const [pkg, allowed] of Object.entries(baseline)) {
        if (!(pkg in found)) {
            unknown.push({ pkg, rule: '*', detail: 'baseline entry for a package that no longer exists' });
            continue;
        }
        for (const a of allowed) {
            const hit = found[pkg].find((v) => v.rule === a.rule);
            if (!hit) {
                stale.push({ pkg, rule: a.rule, detail: 'fixed — drop this baseline entry' });
            } else if (typeof a.count === 'number' && typeof hit.count === 'number' && hit.count < a.count) {
                stale.push({
                    pkg,
                    rule: a.rule,
                    detail: `now ${hit.count}, baseline says ${a.count} — lower it`,
                });
            }
        }
    }

    return { added, stale, unknown };
}

/** Render `found` in the baseline file's shape. */
export function toBaseline(found) {
    const out = {};
    for (const pkg of Object.keys(found).sort()) {
        const entries = found[pkg]
            .map((v) => (typeof v.count === 'number' ? { rule: v.rule, count: v.count } : { rule: v.rule }))
            .sort((a, b) => a.rule.localeCompare(b.rule));
        if (entries.length > 0) out[pkg] = entries;
    }
    return out;
}
