/**
 * Host-capability detection for the dev dashboard.
 *
 * The dashboard is rendered by the installed `sigx` binary, not by this
 * package: `runShell` and `ShellTab.render(pane)` come from whatever
 * `@sigx/cli` the user has. `render(pane)` arrived in 0.9.0 — on an older host
 * `render()` is called with no argument, so every `pane.width` in a tab body is
 * a `TypeError` at first paint.
 *
 * `"requires": ">=0.9.0"` in this package's `sigx-cli` manifest field does NOT
 * prevent that. `@sigx/cli`'s plugin discovery treats `requires` as advisory:
 * it logs `… requires sigx CLI >=0.9.0 but this project runs 0.8.0 — some
 * commands may misbehave` and then loads the plugin anyway. Verified against a
 * real 0.8.0 binary, which registers all our commands after the warning. So
 * the floor is a diagnostic, not a gate, and the gate has to be here.
 *
 * The fallback is not a degraded dashboard — it is the plain streaming banner
 * the `--no-ui` path already uses, which is fully functional. That is the
 * point: rather than reintroduce the terminal-size guesswork the pane replaced,
 * an old host simply gets the older, non-interactive experience.
 */

/** First `@sigx/cli` that passes a `ShellPane` to `ShellTab.render`. */
export const MIN_SHELL_PANE_CLI = '0.9.0';

function parseVersion(v: string): [number, number, number] | null {
    // Tolerate prereleases and build metadata (`0.9.0-beta.1`, `0.9.0+sha`):
    // only the numeric core decides capability, and a prerelease of 0.9.0 has
    // the feature. Anything unparseable is handled by the caller as "unknown".
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim().replace(/^v/, ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/**
 * Whether `cliVersion` is a host that passes a pane to `ShellTab.render`.
 *
 * Unknown or unparseable versions return `false`. That is deliberate: a host
 * that does not report its version is, by definition, not one we have
 * confirmed supports the pane, and the cost of being wrong is asymmetric — a
 * false negative gives the user the plain banner, a false positive gives them
 * a stack trace.
 */
export function supportsShellPane(cliVersion: string | undefined): boolean {
    if (!cliVersion) return false;
    const actual = parseVersion(cliVersion);
    const min = parseVersion(MIN_SHELL_PANE_CLI)!;
    if (!actual) return false;
    for (let i = 0; i < 3; i++) {
        if (actual[i]! !== min[i]!) return actual[i]! > min[i]!;
    }
    return true;
}
