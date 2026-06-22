/**
 * Build-variant merging (issue #530).
 *
 * A variant is a per-environment override of the base `signalx.config.ts`.
 * {@link mergeVariant} takes the raw base config + a variant name and produces a
 * new raw `LynxConfig` with the variant deep-merged in, the app id / display
 * name / scheme auto-suffixed, and non-release signing / OTA-channel defaults
 * applied. The result flows through the normal `resolveConfig` / `resolveAssets`
 * pipeline unchanged — so every downstream consumer (template vars, manifest /
 * plist injection, icons, signing) gets the variant identity for free.
 *
 * Both `resolveConfig` and `resolveAssets` call this independently from the
 * original raw config; merging is pure so the two stay in lockstep.
 */

import type { LynxConfig, VariantConfig } from './schema.js';

/** Variant-only control fields that are NOT part of the config override. */
const CONTROL_KEYS = ['extends', 'idSuffix', 'nameSuffix', 'schemeSuffix', 'release', 'iconBadge'] as const;

/**
 * Variant names flow into filesystem dir names (`android-<name>/`), cache keys,
 * and the app id — so restrict them to a conservative charset. Rejecting path
 * separators / `..` / odd characters prevents path traversal (writing outside
 * the project) and keeps generated ids/dirs well-formed. Fails fast with a
 * clear message.
 */
const VARIANT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Throw unless `name` is a safe variant identifier. */
export function assertValidVariantName(name: string): void {
    if (!VARIANT_NAME_RE.test(name)) {
        throw new Error(
            `Invalid variant name "${name}". Use only letters, digits, '.', '_', '-' ` +
            `(starting with a letter or digit) — names map to the android-<name>/ output dir.`,
        );
    }
}

/** Keys that could mutate a prototype if assigned during a merge. */
const FORBIDDEN_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Resolved per-variant control fields (see {@link VariantConfig}). */
export interface VariantControls {
    idSuffix?: string;
    nameSuffix?: string;
    schemeSuffix?: string;
    release: boolean;
    /** Effective badge label, or null when badging is disabled. */
    iconBadge: string | null;
}

/** Plain `{}`-object guard — excludes arrays and null (both `typeof 'object'`). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `override` onto `base`, returning a new object. Nested plain
 * objects merge recursively; arrays and scalars from `override` replace the
 * base value wholesale (predictable overrides — see {@link VariantConfig}).
 * `undefined` override values are ignored so they don't clobber a base value.
 */
export function deepMerge<T>(base: T, override: unknown): T {
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return (override === undefined ? base : (override as T));
    }
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
        if (value === undefined) continue;
        // Never copy keys that could rewrite a prototype (prototype pollution).
        if (FORBIDDEN_MERGE_KEYS.has(key)) continue;
        out[key] = isPlainObject(value) && isPlainObject(out[key])
            ? deepMerge(out[key], value)
            : value;
    }
    return out as T;
}

/** `com.sigx.<slug>` fallback id — mirrors prebuild's `deriveApplicationId`. */
function deriveAppId(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `com.sigx.${slug || 'app'}`;
}

/**
 * Walk a variant's `extends` chain into an ordered list, base-most → requested.
 * Throws on a missing variant or a cycle.
 */
function resolveChain(variants: Record<string, VariantConfig>, requested: string): string[] {
    const chain: string[] = [];
    const seen = new Set<string>();
    let cur: string | undefined = requested;
    while (cur) {
        if (!(cur in variants)) {
            const available = Object.keys(variants);
            throw new Error(
                cur === requested
                    ? `Unknown variant "${requested}". ${available.length ? `Available: ${available.join(', ')}.` : 'No variants defined in signalx.config.ts.'}`
                    : `Variant "${requested}" extends unknown variant "${cur}".`,
            );
        }
        if (seen.has(cur)) {
            throw new Error(`Variant "${requested}" has a circular \`extends\` chain (revisits "${cur}").`);
        }
        seen.add(cur);
        chain.unshift(cur);
        cur = variants[cur].extends;
    }
    return chain;
}

/** Strip the {@link CONTROL_KEYS} from a variant, leaving the config override. */
function configOverride(v: VariantConfig): Partial<LynxConfig> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(v)) {
        if ((CONTROL_KEYS as readonly string[]).includes(key)) continue;
        out[key] = value;
    }
    return out as Partial<LynxConfig>;
}

/**
 * Apply the named variant to the base config. Returns `{ config, controls }`
 * where `config` is a new raw `LynxConfig` ready for `resolveConfig` /
 * `resolveAssets`. The base config is never mutated.
 */
export function mergeVariant(
    raw: LynxConfig,
    variantName: string,
): { config: LynxConfig; controls: VariantControls } {
    assertValidVariantName(variantName);
    const variants = raw.variants ?? {};
    const chain = resolveChain(variants, variantName);

    // Start from the base, dropping `variants` so the merged config never
    // carries the whole map (and nested variants can't recurse).
    const { variants: _drop, ...baseConfig } = raw;
    let merged: LynxConfig = baseConfig as LynxConfig;
    const baseName = raw.name;

    // Control fields follow last-defined-wins down the chain; config overrides
    // deep-merge in chain order.
    const controls: VariantControls = { release: false, iconBadge: null };
    let iconBadgeSet: string | false | undefined;
    for (const name of chain) {
        const v = variants[name];
        if (v.idSuffix !== undefined) controls.idSuffix = v.idSuffix;
        if (v.nameSuffix !== undefined) controls.nameSuffix = v.nameSuffix;
        if (v.schemeSuffix !== undefined) controls.schemeSuffix = v.schemeSuffix;
        if (v.release !== undefined) controls.release = v.release;
        if (v.iconBadge !== undefined) iconBadgeSet = v.iconBadge;
        merged = deepMerge(merged, configOverride(v));
    }

    // ── Suffix the identity ────────────────────────────────────────────────
    // Display name: explicit `name` override (already merged) then nameSuffix.
    if (controls.nameSuffix) merged.name = `${merged.name}${controls.nameSuffix}`;

    // App id / bundle id: pin to the (base-derived) id when unset so a variant
    // without `idSuffix` keeps the SAME id as the base — not a different one
    // accidentally derived from the suffixed display name — then append the
    // suffix. Append to an explicit id too.
    const android = { ...(merged.android ?? {}) };
    const ios = { ...(merged.ios ?? {}) };
    const baseAndroidId = android.applicationId ?? deriveAppId(baseName);
    const baseIosId = ios.bundleIdentifier ?? deriveAppId(baseName);
    android.applicationId = `${baseAndroidId}${controls.idSuffix ?? ''}`;
    ios.bundleIdentifier = `${baseIosId}${controls.idSuffix ?? ''}`;

    // Deep-link scheme: an explicit `scheme` override anywhere in the chain
    // wins (it's already merged in); otherwise append schemeSuffix to the base
    // scheme when both a base scheme and a suffix exist.
    const overrodeScheme = chain.some((n) => variants[n].scheme !== undefined);
    if (controls.schemeSuffix && merged.scheme && !overrodeScheme) {
        merged.scheme = `${merged.scheme}${controls.schemeSuffix}`;
    }

    // ── Non-release defaults ───────────────────────────────────────────────
    // Automatic signing lets a dev build install on a physical device via the
    // developer's free personal team. Never override an explicit value.
    if (!controls.release && ios.codeSignStyle === undefined) {
        ios.codeSignStyle = 'Automatic';
    }

    // OTA channel auto-bind: a configured `updates` block defaults its channel
    // to the variant name when the chain didn't set one — so standalone OTA
    // testing on a variant build "just works".
    if (merged.updates && merged.updates.defaultChannel === undefined) {
        merged.updates = { ...merged.updates, defaultChannel: variantName };
    }

    merged.android = android;
    merged.ios = ios;

    // Resolve the effective icon badge: explicit string/false wins; otherwise
    // non-release variants get an auto badge from the trimmed nameSuffix (or
    // the variant name). Release variants are unbadged by default.
    if (iconBadgeSet === false) {
        controls.iconBadge = null;
    } else if (typeof iconBadgeSet === 'string') {
        controls.iconBadge = iconBadgeSet;
    } else if (!controls.release) {
        controls.iconBadge = (controls.nameSuffix?.replace(/[()\s]/g, '') || variantName).toUpperCase();
    }

    return { config: merged, controls };
}
