/**
 * npm registry lookups.
 *
 * Lockstep means one fetch covers the whole @sigx/lynx-* family: we only
 * ever resolve the version of `@sigx/lynx-core` (or whichever package the
 * caller picks as the canonical one) and apply it everywhere.
 *
 * `npm view` runs without a shell and only with validated arguments: the
 * version/tag can come from the user (`sigx upgrade --to <x>`), so it must
 * never be spliced into a command line.
 */

import { spawnCommandSync } from './spawn-command.js';

const cache = new Map<string, string>();

export interface RegistryOptions {
    tag?: string;
    /** Network timeout in ms — `npm view` doesn't honour this on every npm
     *  version, but we set it as an env var hint where supported. */
    timeoutMs?: number;
}

const PACKAGE_NAME_RE = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
const VERSION_OR_TAG_RE = /^[\w.+-]+$/;

/** `pkg@spec`, after checking both halves are a plain package name / version / tag. */
export function packageSpec(pkg: string, versionOrTag: string): string {
    if (!PACKAGE_NAME_RE.test(pkg)) throw new Error(`Invalid package name: ${JSON.stringify(pkg)}`);
    if (!VERSION_OR_TAG_RE.test(versionOrTag)) {
        throw new Error(`Invalid version or dist-tag: ${JSON.stringify(versionOrTag)} (expected e.g. 0.32.0 or latest)`);
    }
    return `${pkg}@${versionOrTag}`;
}

function npmView(spec: string, field: string, timeoutMs: number | undefined): string {
    const r = spawnCommandSync('npm', ['view', spec, field, '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf-8',
        timeout: timeoutMs ?? 15_000,
        windowsHide: true,
    });
    if (r.error) throw r.error;
    if (r.status !== 0) {
        throw new Error(`npm view ${spec} ${field} failed: ${String(r.stderr ?? '').trim() || `exit code ${r.status}`}`);
    }
    return String(r.stdout ?? '').trim();
}

/**
 * Fetch the published version of `pkg` matching `tag` (default `latest`).
 * Throws if the registry is unreachable or the package is unpublished.
 */
export function fetchLatestVersion(pkg: string, options: RegistryOptions = {}): string {
    const tag = options.tag ?? 'latest';
    const spec = packageSpec(pkg, tag);
    const cached = cache.get(spec);
    if (cached) return cached;

    const out = npmView(spec, 'version', options.timeoutMs);

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
        throw new Error(`Could not resolve ${spec} from npm registry`);
    }

    cache.set(spec, version);
    return version;
}

/**
 * The `dependencies` (or `peerDependencies`) map a published `pkg@version`
 * declares. Used by `upgrade` to move the core packages
 * (`@sigx/runtime-core`, …) in step with the lynx family. Throws if the
 * registry is unreachable.
 */
export function fetchPublishedDependencies(
    pkg: string,
    version: string,
    options: RegistryOptions & { field?: 'dependencies' | 'peerDependencies' } = {},
): Record<string, string> {
    const out = npmView(packageSpec(pkg, version), options.field ?? 'dependencies', options.timeoutMs);
    if (!out) return {};
    const parsed: unknown = JSON.parse(out);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
}
