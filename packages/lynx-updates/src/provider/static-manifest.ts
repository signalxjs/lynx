/**
 * Built-in static-manifest backend: a JSON document on any static host/CDN.
 *
 * Document shape (one URL can serve every channel/runtime-version — old
 * binaries keep matching their entry while new binaries pick up new ones):
 *
 * ```json
 * {
 *   "schemaVersion": 1,
 *   "updates": [{
 *     "id": "a1b2c3d4e5f60718",
 *     "version": "1.4.2",
 *     "channel": "production",
 *     "platforms": ["android"],
 *     "runtimeVersion": "fp1-3aa01b2c44de9921",
 *     "bundleUrl": "updates/a1b2c3d4e5f60718/main.lynx.bundle",
 *     "sha256": "<64-hex>",
 *     "mandatory": false,
 *     "createdAt": "2026-06-12T10:00:00Z",
 *     "metadata": { "releaseNotes": "Bug fixes." }
 *   }]
 * }
 * ```
 *
 * `sigx updates:publish` emits this document; relative `bundleUrl`s resolve
 * against the manifest URL so the output directory can be dropped onto any
 * static host unchanged.
 *
 * Self-hosted / authenticated backends are supported without writing a custom
 * provider: `url` may be an async resolver (compute the endpoint from runtime
 * context discovered after launch — sign-in, environment selection), and
 * `onBeforeCheck` / `onBeforeDownload` inject fresh per-request headers (a
 * short-lived bearer token refreshed each call) on top of the static `headers`.
 */

import {
    UpdatesError,
    type DownloadSpec,
    type UpdateCheckContext,
    type UpdateCheckResult,
    type UpdateManifest,
    type UpdateProvider,
} from '../types.js';

type MaybePromise<T> = T | Promise<T>;
type HeadersMap = Record<string, string>;

/** A resolved manifest endpoint: the URL, optionally with endpoint-specific headers. */
export interface ManifestEndpoint {
    url: string;
    headers?: HeadersMap;
}

export interface StaticManifestEntry extends Omit<UpdateManifest, 'id' | 'mandatory'> {
    id?: string;
    mandatory?: boolean;
    /** Platforms this entry serves. Default: both. */
    platforms?: string[];
    /** Release channel. Default 'production'. */
    channel?: string;
}

export interface StaticManifestDocument {
    schemaVersion: number;
    updates: StaticManifestEntry[];
}

export interface StaticManifestProviderOptions {
    /**
     * Manifest JSON location. Either:
     * - a static absolute URL, or
     * - an async resolver invoked before every check — return the URL (or
     *   `{ url, headers }`) computed from `ctx`. Use this when the backend host
     *   isn't known until after launch (sign-in, environment selection,
     *   per-deployment configuration). Relative `bundleUrl`s in the manifest
     *   resolve against whichever URL the resolver returned for that check.
     */
    url: string | ((ctx: UpdateCheckContext) => MaybePromise<string | ManifestEndpoint>);
    /** Static headers, merged into every manifest request AND bundle download. */
    headers?: HeadersMap;
    /**
     * Per-check auth hook. Returned headers are merged over `headers` (and over
     * any headers from the `url` resolver) for the manifest request — inject a
     * fresh short-lived token here and refresh it inside the hook on expiry.
     */
    onBeforeCheck?: (ctx: UpdateCheckContext) => MaybePromise<HeadersMap>;
    /**
     * Per-download auth hook. Returned headers are merged over `headers` for the
     * bundle download (a separate, often longer-lived request than the check).
     */
    onBeforeDownload?: (manifest: UpdateManifest, ctx: UpdateCheckContext) => MaybePromise<HeadersMap>;
    /** Injectable fetch for tests. Defaults to `globalThis.fetch`. */
    fetchImpl?: typeof globalThis.fetch;
}

/**
 * Validate a parsed manifest document. Returns human-readable errors
 * (empty array = valid). Exported for `sigx updates:publish` and tests.
 */
export function validateUpdatesManifest(doc: unknown): string[] {
    const errors: string[] = [];
    if (!doc || typeof doc !== 'object') return ['Manifest must be a JSON object'];
    const d = doc as Record<string, unknown>;
    if (d.schemaVersion !== 1) errors.push('Unsupported or missing "schemaVersion" (expected 1)');
    if (!Array.isArray(d.updates)) {
        errors.push('Missing "updates" array');
        return errors;
    }
    d.updates.forEach((entry, i) => {
        if (!entry || typeof entry !== 'object') {
            errors.push(`updates[${i}] must be an object`);
            return;
        }
        const e = entry as Record<string, unknown>;
        for (const field of ['version', 'runtimeVersion', 'bundleUrl', 'sha256'] as const) {
            if (typeof e[field] !== 'string' || (e[field] as string).length === 0) {
                errors.push(`updates[${i}].${field} must be a non-empty string`);
            }
        }
        if (typeof e.sha256 === 'string' && !/^[0-9a-f]{64}$/i.test(e.sha256)) {
            errors.push(`updates[${i}].sha256 must be 64 hex characters`);
        }
        // Optional fields must still be well-typed — selection logic calls
        // .includes()/string compares on them, and a malformed value must
        // surface as check-failed, not a TypeError.
        if (e.platforms !== undefined &&
            (!Array.isArray(e.platforms) || !e.platforms.every((p) => p === 'android' || p === 'ios'))) {
            errors.push(`updates[${i}].platforms must be an array of 'android' | 'ios'`);
        }
        for (const field of ['channel', 'id', 'createdAt'] as const) {
            if (e[field] !== undefined && typeof e[field] !== 'string') {
                errors.push(`updates[${i}].${field} must be a string when present`);
            }
        }
        if (e.mandatory !== undefined && typeof e.mandatory !== 'boolean') {
            errors.push(`updates[${i}].mandatory must be a boolean when present`);
        }
    });
    return errors;
}

/** Default id derivation: content-addressed prefix of the bundle hash. */
function entryId(entry: StaticManifestEntry): string {
    return entry.id ?? entry.sha256.slice(0, 16);
}

/** Resolve a possibly-relative bundle URL against the manifest URL. */
function resolveBundleUrl(bundleUrl: string, manifestUrl: string): string {
    if (/^https?:\/\//i.test(bundleUrl)) return bundleUrl;
    // Manual resolution — the Lynx BG runtime has no global URL constructor.
    const base = manifestUrl.replace(/[^/]*$/, '');
    return base + bundleUrl.replace(/^\.\//, '');
}

function toManifest(entry: StaticManifestEntry, manifestUrl: string): UpdateManifest {
    return {
        id: entryId(entry),
        version: entry.version,
        runtimeVersion: entry.runtimeVersion,
        bundleUrl: resolveBundleUrl(entry.bundleUrl, manifestUrl),
        sha256: entry.sha256.toLowerCase(),
        mandatory: entry.mandatory === true,
        createdAt: entry.createdAt,
        metadata: entry.metadata,
    };
}

/** Merge header maps left-to-right (later wins); undefined when the result is empty. */
function mergeHeaders(...parts: Array<HeadersMap | undefined>): HeadersMap | undefined {
    const out: HeadersMap = {};
    for (const part of parts) {
        if (part) Object.assign(out, part);
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** Newest entry wins: by createdAt when present, else last in array order. */
function newest(entries: StaticManifestEntry[]): StaticManifestEntry | undefined {
    if (entries.length === 0) return undefined;
    const sorted = [...entries].sort((a, b) => {
        const ta = a.createdAt ? Date.parse(a.createdAt) : Number.NaN;
        const tb = b.createdAt ? Date.parse(b.createdAt) : Number.NaN;
        if (Number.isNaN(ta) && Number.isNaN(tb)) return 0; // stable → array order
        if (Number.isNaN(ta)) return -1;
        if (Number.isNaN(tb)) return 1;
        return ta - tb;
    });
    return sorted[sorted.length - 1];
}

export class StaticManifestProvider implements UpdateProvider {
    readonly name = 'static-manifest';

    constructor(private readonly options: StaticManifestProviderOptions) {}

    /** Resolve the manifest URL (+ optional endpoint headers) for this check. */
    private async resolveEndpoint(ctx: UpdateCheckContext): Promise<ManifestEndpoint> {
        const { url } = this.options;
        const resolved = typeof url === 'function' ? await url(ctx) : url;
        return typeof resolved === 'string' ? { url: resolved } : resolved;
    }

    async checkForUpdate(ctx: UpdateCheckContext): Promise<UpdateCheckResult> {
        const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new UpdatesError('check-failed', 'No fetch implementation available — import @sigx/lynx (or @sigx/lynx-http) before checking for updates');
        }

        let doc: unknown;
        // Assigned inside the try before any throw the catch re-raises, so it is
        // always set by the time selection runs below.
        let manifestUrl!: string;
        try {
            const endpoint = await this.resolveEndpoint(ctx);
            manifestUrl = endpoint.url;
            const headers = mergeHeaders(
                this.options.headers,
                endpoint.headers,
                await this.options.onBeforeCheck?.(ctx),
            );
            const res = await fetchImpl(endpoint.url, { headers });
            if (!res.ok) {
                throw new UpdatesError('check-failed', `Manifest request failed: HTTP ${res.status}`);
            }
            doc = await res.json();
        } catch (err) {
            if (err instanceof UpdatesError) throw err;
            throw new UpdatesError('check-failed', `Manifest request failed: ${(err as Error)?.message ?? err}`);
        }

        const errors = validateUpdatesManifest(doc);
        if (errors.length > 0) {
            throw new UpdatesError('check-failed', `Invalid updates manifest: ${errors.join('; ')}`);
        }

        const channel = ctx.channel ?? 'production';
        const candidates = (doc as StaticManifestDocument).updates.filter((e) =>
            (e.platforms ?? ['android', 'ios']).includes(ctx.platform) &&
            (e.channel ?? 'production') === channel,
        );

        const compatible = candidates.filter((e) => e.runtimeVersion === ctx.runtimeVersion);
        const best = newest(compatible);
        if (best) {
            const manifest = toManifest(best, manifestUrl);
            return manifest.id === ctx.currentUpdateId
                ? { type: 'up-to-date' }
                : { type: 'update-available', manifest };
        }

        // No compatible entry — surface the newest INCOMPATIBLE one (if any)
        // so the app can tell "you're current" apart from "a newer release
        // exists but needs a store update".
        const incompatible = newest(candidates);
        if (incompatible) {
            return { type: 'incompatible', manifest: toManifest(incompatible, manifestUrl) };
        }
        return { type: 'up-to-date' };
    }

    async resolveDownload(manifest: UpdateManifest, ctx: UpdateCheckContext): Promise<DownloadSpec> {
        return {
            url: manifest.bundleUrl,
            sha256: manifest.sha256,
            headers: mergeHeaders(this.options.headers, await this.options.onBeforeDownload?.(manifest, ctx)),
        };
    }
}
