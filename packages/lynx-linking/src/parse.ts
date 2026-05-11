export interface ParsedURL {
    scheme: string;
    hostname: string;
    path: string;
    queryParams: Record<string, string>;
}

const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/;

/**
 * Parse a URL string into its components.
 *
 * Pure JS — works in tests, SSR, and main thread without a native bridge.
 *
 * Supports:
 *   - `myapp://host/path?a=1&b=2`     → scheme="myapp", hostname="host", path="/path", queryParams={a:"1",b:"2"}
 *   - `https://example.com/foo/bar`    → standard http(s) URLs
 *   - `mailto:test@example.com`        → scheme="mailto", path="test@example.com"
 *   - `tel:+15551234`                   → scheme="tel", path="+15551234"
 *   - `myapp:foo`                       → opaque schemes — path = "foo"
 *
 * Always returns lowercased scheme. Fragments are stripped.
 */
export function parse(url: string): ParsedURL {
    if (typeof url !== 'string') {
        throw new TypeError('parse() expects a string URL');
    }

    let rest = url;
    const fragmentIdx = rest.indexOf('#');
    if (fragmentIdx >= 0) rest = rest.slice(0, fragmentIdx);

    const schemeMatch = SCHEME_RE.exec(rest);
    if (!schemeMatch) {
        return { scheme: '', hostname: '', path: rest, queryParams: parseQuery('') };
    }

    const scheme = schemeMatch[1].toLowerCase();
    rest = rest.slice(schemeMatch[0].length);

    let hostname = '';
    let pathAndQuery = rest;

    if (rest.startsWith('//')) {
        const afterSlashes = rest.slice(2);
        const pathStart = afterSlashes.search(/[\/?]/);
        if (pathStart === -1) {
            hostname = afterSlashes;
            pathAndQuery = '';
        } else {
            hostname = afterSlashes.slice(0, pathStart);
            pathAndQuery = afterSlashes.slice(pathStart);
        }
    }

    const queryIdx = pathAndQuery.indexOf('?');
    let path: string;
    let queryString: string;
    if (queryIdx === -1) {
        path = pathAndQuery;
        queryString = '';
    } else {
        path = pathAndQuery.slice(0, queryIdx);
        queryString = pathAndQuery.slice(queryIdx + 1);
    }

    return { scheme, hostname, path, queryParams: parseQuery(queryString) };
}

function parseQuery(qs: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!qs) return out;
    for (const piece of qs.split('&')) {
        if (!piece) continue;
        const eq = piece.indexOf('=');
        const rawKey = eq === -1 ? piece : piece.slice(0, eq);
        const rawVal = eq === -1 ? '' : piece.slice(eq + 1);
        const key = safeDecode(rawKey);
        if (!key) continue;
        out[key] = safeDecode(rawVal);
    }
    return out;
}

function safeDecode(s: string): string {
    try {
        return decodeURIComponent(s.replace(/\+/g, ' '));
    } catch {
        return s;
    }
}

/**
 * Build a URL string from a path and optional query params. Useful for
 * generating outgoing deep links (e.g. for a share sheet) with proper
 * percent-encoding.
 *
 * If `path` already has a scheme (`myapp://...`), it's used verbatim before
 * the query is appended.
 */
export function createURL(path: string, queryParams?: Record<string, string>): string {
    const qs = queryParams
        ? Object.entries(queryParams)
              .filter(([, v]) => v !== undefined && v !== null)
              .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
              .join('&')
        : '';
    if (!qs) return path;
    return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}
