/**
 * WHATWG-shaped `Headers` — enough surface for portable fetch code.
 * Case-insensitive names; multi-value appends combine with `", "` (the
 * HTTP wire rule); iteration yields lowercase names sorted, like browsers.
 */

export type HeadersInitLike =
    | Headers
    | Record<string, string>
    | Iterable<readonly [string, string]>;

function normalizeName(name: string): string {
    const n = String(name).toLowerCase();
    if (n.length === 0 || /[^!#$%&'*+\-.^_`|~0-9a-z]/.test(n)) {
        throw new TypeError(`Headers: invalid header name "${name}"`);
    }
    return n;
}

function normalizeValue(value: string): string {
    // Per spec: strip leading/trailing HTTP whitespace.
    const v = String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
    // Embedded CR/LF/NUL is a header-injection vector (and crashes OkHttp's
    // header validation) — reject like platform Headers do.
    if (/[\r\n\0]/.test(v)) {
        throw new TypeError('Headers: header value contains forbidden control characters');
    }
    return v;
}

export class Headers {
    private readonly map = new Map<string, string>();

    constructor(init?: HeadersInitLike) {
        if (init === undefined || init === null) return;
        if (init instanceof Headers) {
            for (const [k, v] of init) this.append(k, v);
            return;
        }
        if (typeof (init as Iterable<readonly [string, string]>)[Symbol.iterator] === 'function') {
            for (const pair of init as Iterable<readonly [string, string]>) {
                if (!pair || (pair as readonly string[]).length !== 2) {
                    throw new TypeError('Headers: init pairs must be [name, value]');
                }
                this.append(pair[0], pair[1]);
            }
            return;
        }
        for (const [k, v] of Object.entries(init as Record<string, string>)) {
            this.append(k, v);
        }
    }

    append(name: string, value: string): void {
        const n = normalizeName(name);
        const v = normalizeValue(value);
        const existing = this.map.get(n);
        this.map.set(n, existing === undefined ? v : `${existing}, ${v}`);
    }

    set(name: string, value: string): void {
        this.map.set(normalizeName(name), normalizeValue(value));
    }

    get(name: string): string | null {
        return this.map.get(normalizeName(name)) ?? null;
    }

    has(name: string): boolean {
        return this.map.has(normalizeName(name));
    }

    delete(name: string): void {
        this.map.delete(normalizeName(name));
    }

    forEach(fn: (value: string, name: string, parent: Headers) => void, thisArg?: unknown): void {
        for (const [k, v] of this) fn.call(thisArg, v, k, this);
    }

    *entries(): IterableIterator<[string, string]> {
        for (const k of [...this.map.keys()].sort()) {
            yield [k, this.map.get(k) as string];
        }
    }

    *keys(): IterableIterator<string> {
        for (const [k] of this.entries()) yield k;
    }

    *values(): IterableIterator<string> {
        for (const [, v] of this.entries()) yield v;
    }

    [Symbol.iterator](): IterableIterator<[string, string]> {
        return this.entries();
    }

    /** Flatten to the plain record the bridge spec carries. */
    toRecord(): Record<string, string> {
        const out: Record<string, string> = {};
        for (const [k, v] of this) out[k] = v;
        return out;
    }
}
