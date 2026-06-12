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
 */

import {
    UpdatesError,
    type UpdateCheckContext,
    type UpdateCheckResult,
    type UpdateManifest,
    type UpdateProvider,
} from '../types.js';

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
    /** Absolute URL of the manifest JSON. */
    url: string;
    /** Extra headers sent with the manifest request AND bundle download. */
    headers?: Record<string, string>;
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

    async checkForUpdate(ctx: UpdateCheckContext): Promise<UpdateCheckResult> {
        const fetchImpl = this.options.fetchImpl ?? globalThis.fetch;
        if (typeof fetchImpl !== 'function') {
            throw new UpdatesError('check-failed', 'No fetch implementation available — import @sigx/lynx (or @sigx/lynx-http) before checking for updates');
        }

        let doc: unknown;
        try {
            const res = await fetchImpl(this.options.url, { headers: this.options.headers });
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
            const manifest = toManifest(best, this.options.url);
            return manifest.id === ctx.currentUpdateId
                ? { type: 'up-to-date' }
                : { type: 'update-available', manifest };
        }

        // No compatible entry — surface the newest INCOMPATIBLE one (if any)
        // so the app can tell "you're current" apart from "a newer release
        // exists but needs a store update".
        const incompatible = newest(candidates);
        if (incompatible) {
            return { type: 'incompatible', manifest: toManifest(incompatible, this.options.url) };
        }
        return { type: 'up-to-date' };
    }

    async resolveDownload(manifest: UpdateManifest) {
        return {
            url: manifest.bundleUrl,
            sha256: manifest.sha256,
            headers: this.options.headers,
        };
    }
}
