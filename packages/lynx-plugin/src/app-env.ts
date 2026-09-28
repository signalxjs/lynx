/**
 * App environment (issue #1244) — the typed `env` block of `signalx.config.ts`,
 * plumbed from `@sigx/lynx-cli` as canonical JSON in `SIGX_LYNX_ENV`.
 *
 * The plugin bakes it into the bundle as the `__SIGX_APP_ENV__` define (read by
 * `env` in `@sigx/lynx-core`) and, after a production build, writes
 * `.sigx-build.json` next to the bundle so `sigx updates:publish` can refuse a
 * bundle built for a different variant. Keep the marker shape in sync with
 * `BuildMarker` in `@sigx/lynx-cli`'s `updates-publish.ts`.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** File name of the build marker written next to the bundle. */
export const BUILD_MARKER_FILE = '.sigx-build.json';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The app env from `signalx.config.ts` (with the active `--variant` merged in),
 * for use inside `lynx.config.ts`. `{}` when not run through the `sigx` CLI.
 *
 * @example
 * ```ts
 * // lynx.config.ts
 * import { appEnv } from '@sigx/lynx-plugin';
 * const { apiBaseUrl } = appEnv<{ apiBaseUrl: string }>();
 * ```
 */
export function appEnv<T extends object = Record<string, unknown>>(): T {
  const raw = process.env['SIGX_LYNX_ENV'];
  if (!raw) return {} as T;
  try {
    const parsed: unknown = JSON.parse(raw);
    return (isPlainObject(parsed) ? parsed : {}) as T;
  } catch {
    return {} as T;
  }
}

/**
 * JSON source for the `__SIGX_APP_ENV__` define. Re-serialized from
 * {@link appEnv} so a malformed `SIGX_LYNX_ENV` can't inject arbitrary code; for
 * the canonical JSON lynx-cli writes this is the same string.
 */
export function appEnvDefine(): string {
  return JSON.stringify(appEnv());
}

/** Build marker contents — see `BuildMarker` in `@sigx/lynx-cli`. */
export interface BuildMarker {
  variant: string;
  envHash: string;
  channel: string;
  builtAt: string;
}

/** The marker for the current build env (`SIGX_LYNX_*` set by lynx-cli). */
export function buildMarker(now: Date = new Date()): BuildMarker {
  return {
    variant: process.env['SIGX_LYNX_VARIANT'] || '',
    envHash: createHash('sha256').update(appEnvDefine()).digest('hex'),
    channel: process.env['SIGX_LYNX_UPDATES_CHANNEL'] || 'production',
    builtAt: now.toISOString(),
  };
}

/** Write {@link buildMarker} into each of `dirs` (deduplicated). */
export function writeBuildMarker(dirs: readonly string[]): void {
  const json = JSON.stringify(buildMarker(), null, 2) + '\n';
  for (const dir of new Set(dirs.map((d) => path.resolve(d)))) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, BUILD_MARKER_FILE), json);
  }
}
