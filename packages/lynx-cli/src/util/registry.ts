/**
 * npm registry lookups.
 *
 * Lockstep means one fetch covers the whole @sigx/lynx-* family: we only
 * ever resolve the version of `@sigx/lynx-core` (or whichever package the
 * caller picks as the canonical one) and apply it everywhere.
 */

import { execSync } from 'node:child_process';

const cache = new Map<string, string>();

export interface RegistryOptions {
    tag?: string;
    /** Network timeout in ms — `npm view` doesn't honour this on every npm
     *  version, but we set it as an env var hint where supported. */
    timeoutMs?: number;
}

function cacheKey(pkg: string, tag: string): string {
    return `${pkg}@${tag}`;
}

/**
 * Fetch the published version of `pkg` matching `tag` (default `latest`).
 * Throws if the registry is unreachable or the package is unpublished.
 */
export function fetchLatestVersion(pkg: string, options: RegistryOptions = {}): string {
    const tag = options.tag ?? 'latest';
    const key = cacheKey(pkg, tag);
    const cached = cache.get(key);
    if (cached) return cached;

    const cmd = `npm view ${pkg}@${tag} version --json`;
    const out = execSync(cmd, {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: options.timeoutMs ?? 15_000,
    }).trim();

    // `npm view` returns a JSON-encoded string for a single version, or a
    // JSON array if `pkg@tag` matched multiple. Take the last (newest) in
    // either case.
    const parsed: unknown = out ? JSON.parse(out) : null;
    let version: string | null = null;
    if (typeof parsed === 'string') version = parsed;
    else if (Array.isArray(parsed) && parsed.length > 0) {
        version = String(parsed[parsed.length - 1]);
    }
    if (!version) {
        throw new Error(`Could not resolve ${pkg}@${tag} from npm registry`);
    }

    cache.set(key, version);
    return version;
}
