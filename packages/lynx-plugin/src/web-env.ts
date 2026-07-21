/**
 * Zero-config web environments (signalxjs/lynx#699) — internal helper, not
 * part of the package's public API (the entrypoint only re-exports the
 * plugin; tests import this module directly).
 */

/**
 * Ensure `environments.lynx` + `environments.web` keys exist on the rsbuild
 * config, merging only the keys that are absent — present keys (whatever
 * their value) and every other user-declared environment are never touched; a
 * config that already has both is returned as-is. Called only when a web
 * build is requested (`SIGX_WEB_ENV=1`) and the `web` plugin option isn't
 * `false`.
 */
export function ensureWebEnvironments<T extends { environments?: Record<string, unknown> }>(
  config: T,
  merge: (a: T, b: { environments: Record<string, Record<string, never>> }) => T,
): T {
  const envs = config.environments ?? {};
  const patch: Record<string, Record<string, never>> = {};
  if (!('lynx' in envs)) patch['lynx'] = {};
  if (!('web' in envs)) patch['web'] = {};
  if (Object.keys(patch).length === 0) return config;
  return merge(config, { environments: patch });
}
