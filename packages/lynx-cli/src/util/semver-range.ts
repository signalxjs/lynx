/**
 * Minimal semver range matching for the version sanity checks
 * (`core-compat.ts`). Covers the range shapes npm packages actually declare:
 * exact, `^`, `~`, comparators (`>=`, `>`, `<=`, `<`, `=`), `x`/`*`
 * wildcards, space-separated AND sets and `||` alternatives. Prereleases are
 * compared on their `x.y.z` core only — good enough for "is this install
 * compatible", and it keeps the CLI free of a `semver` dependency.
 */

type Triple = [number, number, number];

function parseVersion(v: string): Triple | null {
    const m = v.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: Triple, b: Triple): number {
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
}

/** Parse a possibly-partial version (`1`, `1.2`, `1.x`) into its known parts. */
function parsePartial(v: string): number[] | null {
    const parts = v.trim().replace(/^v/, '').split('.');
    const out: number[] = [];
    for (const p of parts.slice(0, 3)) {
        if (p === 'x' || p === 'X' || p === '*' || p === '') break;
        const n = Number(p.split('-')[0]);
        if (!Number.isInteger(n)) return null;
        out.push(n);
    }
    return out;
}

function pad(parts: number[]): Triple {
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Upper bound (exclusive) for a partial like `1.2` → `1.3.0`, `1` → `2.0.0`. */
function bumpPartial(parts: number[]): Triple {
    if (parts.length === 0) return [Infinity, 0, 0];
    if (parts.length === 1) return [parts[0] + 1, 0, 0];
    if (parts.length === 2) return [parts[0], parts[1] + 1, 0];
    return [parts[0], parts[1], parts[2] + 1];
}

function matchesComparator(version: Triple, comp: string): boolean {
    if (comp === '' || comp === '*' || comp === 'x' || comp === 'X') return true;

    const caret = comp.match(/^\^(.+)$/);
    if (caret) {
        const parts = parsePartial(caret[1]);
        if (!parts) return false;
        const lo = pad(parts);
        // ^1.2.3 → <2.0.0 · ^0.2.3 → <0.3.0 · ^0.0.3 → <0.0.4
        let hi: Triple;
        if (parts.length === 0) hi = [Infinity, 0, 0];
        else if (lo[0] > 0 || parts.length === 1) hi = [lo[0] + 1, 0, 0];
        else if (lo[1] > 0 || parts.length === 2) hi = [0, lo[1] + 1, 0];
        else hi = [0, 0, lo[2] + 1];
        return cmp(version, lo) >= 0 && cmp(version, hi) < 0;
    }

    const tilde = comp.match(/^~>?(.+)$/);
    if (tilde) {
        const parts = parsePartial(tilde[1]);
        if (!parts) return false;
        const lo = pad(parts);
        const hi: Triple = parts.length <= 1 ? bumpPartial(parts) : [lo[0], lo[1] + 1, 0];
        return cmp(version, lo) >= 0 && cmp(version, hi) < 0;
    }

    const op = comp.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
    if (!op) return false;
    const [, operator = '=', rest] = op;
    const parts = parsePartial(rest);
    if (!parts) return false;
    const full = parts.length === 3;
    const lo = pad(parts);
    const hi = bumpPartial(parts);
    switch (operator) {
        case '>=': return cmp(version, lo) >= 0;
        case '>': return full ? cmp(version, lo) > 0 : cmp(version, hi) >= 0;
        case '<=': return full ? cmp(version, lo) <= 0 : cmp(version, hi) < 0;
        case '<': return cmp(version, lo) < 0;
        default: return cmp(version, lo) >= 0 && cmp(version, hi) < 0;
    }
}

/**
 * True when `range` is something we can evaluate — protocol ranges
 * (`workspace:`, `catalog:`, `file:`, `npm:`, git/URLs) and dist-tags are
 * not, and callers should skip the check rather than guess.
 */
export function isCheckableRange(range: string): boolean {
    const r = range.trim();
    if (r === '') return false;
    if (/^[a-z]+:/i.test(r)) return false;
    return /^[\d\s^~<>=|.xX*v-]+$/.test(r.replace(/-[\w.]+/g, ''));
}

/** Does `version` satisfy `range`? Returns false for unparseable input. */
export function satisfies(version: string, range: string): boolean {
    const v = parseVersion(version);
    if (!v) return false;
    return range.split('||').some((set) => {
        // Hyphen ranges: `1.2.3 - 2.3.4`
        const hyphen = set.match(/^\s*(\S+)\s+-\s+(\S+)\s*$/);
        if (hyphen) {
            return matchesComparator(v, `>=${hyphen[1]}`) && matchesComparator(v, `<=${hyphen[2]}`);
        }
        const comps = set.trim().replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1').split(/\s+/);
        return comps.every((c) => matchesComparator(v, c));
    });
}
