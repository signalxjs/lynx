/**
 * App environment (issue #1244) — the typed `env` block of `signalx.config.ts`.
 *
 * `resolveConfig` validates the (variant-merged) env with
 * {@link assertJsonEnv}, warns about secret-looking keys
 * ({@link findSecretLookingKeys}) and exports {@link canonicalEnvJson} as
 * `SIGX_LYNX_ENV`, which `@sigx/lynx-plugin` bakes into the bundle as
 * `__SIGX_APP_ENV__`. The plugin stamps `dist/.sigx-build.json` with the sha256
 * of that exact string, so `sigx updates:publish` can compare it against
 * {@link envHash} of the config it resolves.
 *
 * {@link loadDotenvFiles} runs before the config is evaluated so the config can
 * read `process.env` (`.env.local` locally, real env in CI).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/** Plain `{}`-object guard (object literal or `Object.create(null)`). */
function isPlainObject(v: unknown): v is Record<string, unknown> {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
    const proto = Object.getPrototypeOf(v);
    return proto === Object.prototype || proto === null;
}

function describe(v: unknown): string {
    if (v === undefined) return 'undefined';
    if (typeof v === 'function') return 'a function';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'bigint') return 'a bigint';
    if (typeof v === 'symbol') return 'a symbol';
    const name = (v as object).constructor?.name;
    return name ? `a ${name}` : 'a non-plain object';
}

/**
 * Throw unless `env` is a plain JSON object — it is serialized into the
 * bundle, so anything `JSON.stringify` would drop or mangle is an error,
 * reported with its key path (`env.api.timeout`).
 */
export function assertJsonEnv(env: unknown): void {
    if (env === undefined) return;
    const visit = (v: unknown, path: string): void => {
        if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
        if (typeof v === 'number') {
            if (Number.isFinite(v)) return;
        } else if (Array.isArray(v)) {
            v.forEach((item, i) => visit(item, `${path}[${i}]`));
            return;
        } else if (isPlainObject(v)) {
            for (const [key, value] of Object.entries(v)) visit(value, `${path}.${key}`);
            return;
        }
        const hint = v === undefined
            ? ' (an unset process.env variable? Use requireEnv() or a fallback like `?? \'\'`)'
            : '';
        throw new Error(
            `signalx.config.ts: ${path} is ${describe(v)} — app env values must be JSON ` +
            `(string, number, boolean, null, arrays, plain objects)${hint}.`,
        );
    };
    if (!isPlainObject(env)) {
        throw new Error(`signalx.config.ts: env must be a plain object, got ${describe(env)}.`);
    }
    visit(env, 'env');
}

const SECRET_KEY_RE = /secret|password|passwd|private|token/i;

/**
 * Dotted paths of env keys whose name looks like a secret, minus those whose
 * leaf key is listed in `allow` (`envAllow`). Everything in `env` ships inside
 * the app, readable by anyone who has it.
 */
export function findSecretLookingKeys(env: unknown, allow: readonly string[] = []): string[] {
    const allowed = new Set(allow);
    const out: string[] = [];
    const visit = (v: unknown, path: string): void => {
        if (Array.isArray(v)) {
            v.forEach((item, i) => visit(item, `${path}[${i}]`));
        } else if (isPlainObject(v)) {
            for (const [key, value] of Object.entries(v)) {
                const keyPath = `${path}.${key}`;
                if (SECRET_KEY_RE.test(key) && !allowed.has(key)) out.push(keyPath);
                visit(value, keyPath);
            }
        }
    };
    visit(env, 'env');
    return out;
}

/** Deterministic JSON (object keys sorted) — stable input for {@link envHash}. */
export function canonicalEnvJson(env: unknown): string {
    const sort = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(sort);
        if (isPlainObject(v)) {
            const out: Record<string, unknown> = {};
            for (const key of Object.keys(v).sort()) out[key] = sort(v[key]);
            return out;
        }
        return v;
    };
    return JSON.stringify(sort(env ?? {}));
}

/** sha256 (hex) of an already-canonical env JSON string. */
export function hashEnvJson(json: string): string {
    return createHash('sha256').update(json).digest('hex');
}

/** sha256 (hex) of the canonical JSON of `env` — see `.sigx-build.json`. */
export function envHash(env: unknown): string {
    return hashEnvJson(canonicalEnvJson(env));
}

/**
 * `.env` files loaded before `signalx.config.ts` is evaluated, lowest →
 * highest precedence.
 */
export function dotenvFiles(variant?: string): string[] {
    const files = ['.env', '.env.local'];
    if (variant) files.push(`.env.${variant}`, `.env.${variant}.local`);
    return files;
}

/**
 * Load `.env`, `.env.local`, `.env.<variant>`, `.env.<variant>.local` from
 * `cwd` into `env` (default `process.env`). Later files override earlier ones;
 * a variable already set in the real environment (e.g. a CI secret) always
 * wins. Returns the names of the files that were loaded.
 */
export function loadDotenvFiles(
    cwd: string,
    variant?: string,
    env: Record<string, string | undefined> = process.env,
): string[] {
    const loaded: string[] = [];
    const merged: Record<string, string> = {};
    for (const file of dotenvFiles(variant)) {
        const path = join(cwd, file);
        if (!existsSync(path)) continue;
        Object.assign(merged, parseEnv(readFileSync(path, 'utf-8')));
        loaded.push(file);
    }
    for (const [key, value] of Object.entries(merged)) {
        if (env[key] === undefined) env[key] = value;
    }
    return loaded;
}
