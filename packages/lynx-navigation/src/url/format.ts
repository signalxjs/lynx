/**
 * Format helpers: typed params/search → URL string.
 *
 * Used by `hrefFor()` to render the `url` field of an Href.
 */

/**
 * Serialize an object as a `key=value&key=value` querystring.
 *
 * Keys are sorted to make the output deterministic (useful for tests and
 * persistence diffs). `undefined`/`null` values are skipped. Non-primitive
 * values are JSON-stringified — parseHref reverses this on the receiving end.
 *
 * Returns `''` (empty string) when there are no entries — callers join with
 * `?` only when the result is non-empty.
 */
export function formatSearch(search: Record<string, unknown> | undefined): string {
    if (!search) return '';
    const keys = Object.keys(search).sort();
    const parts: string[] = [];
    for (const key of keys) {
        const value = search[key];
        if (value === undefined || value === null) continue;
        const encoded = encodeURIComponent(key);
        if (Array.isArray(value)) {
            for (const item of value) {
                if (item === undefined || item === null) continue;
                parts.push(`${encoded}=${encodeURIComponent(serializeScalar(item))}`);
            }
        } else {
            parts.push(`${encoded}=${encodeURIComponent(serializeScalar(value))}`);
        }
    }
    return parts.join('&');
}

/**
 * Parse a `key=value&key=value` querystring into a string-keyed bag. Values
 * are decoded but kept as strings — typed coercion happens in the route's
 * `search` schema (e.g. Zod's `z.coerce.number()`).
 *
 * Multiple occurrences of the same key produce an array. Schemas that don't
 * expect arrays will reject this — that's the right failure mode.
 */
export function parseSearch(query: string): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    if (!query) return result;
    // Strip leading `?` if present (formatHref doesn't include it but callers
    // sometimes pass `?a=1`).
    const cleaned = query.startsWith('?') ? query.slice(1) : query;
    if (!cleaned) return result;
    for (const pair of cleaned.split('&')) {
        if (!pair) continue;
        const eqIdx = pair.indexOf('=');
        const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
        const rawValue = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
        const key = safeDecode(rawKey);
        const value = safeDecode(rawValue);
        const existing = result[key];
        if (existing === undefined) {
            result[key] = value;
        } else if (Array.isArray(existing)) {
            existing.push(value);
        } else {
            result[key] = [existing, value];
        }
    }
    return result;
}

function serializeScalar(v: unknown): string {
    switch (typeof v) {
        case 'string': return v;
        case 'number':
        case 'boolean':
        case 'bigint':
            return String(v);
        default:
            // Objects/arrays/etc — JSON. Schemas can decide how to interpret.
            return JSON.stringify(v);
    }
}

function safeDecode(s: string): string {
    try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch {
        // Malformed % escape — fall back to the raw text rather than throwing
        // from a navigation hot path. The schema will reject if it matters.
        return s;
    }
}
