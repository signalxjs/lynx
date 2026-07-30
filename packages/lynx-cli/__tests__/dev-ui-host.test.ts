/**
 * The dashboard is only safe on a host that passes a `ShellPane` to
 * `ShellTab.render`. `"requires"` in the plugin manifest does not enforce that
 * — `@sigx/cli` warns and loads the plugin anyway — so this check is the real
 * gate, and it needs to be conservative in the right direction.
 */
import { describe, it, expect } from 'vitest';
import { supportsShellPane, MIN_SHELL_PANE_CLI } from '../src/dev-ui/host';

describe('supportsShellPane', () => {
    it('accepts the minimum and anything newer', () => {
        expect(supportsShellPane(MIN_SHELL_PANE_CLI)).toBe(true);
        expect(supportsShellPane('0.9.0')).toBe(true);
        expect(supportsShellPane('0.9.1')).toBe(true);
        expect(supportsShellPane('0.10.0')).toBe(true);
        expect(supportsShellPane('1.0.0')).toBe(true);
    });

    it('rejects the versions that call render() with no argument', () => {
        expect(supportsShellPane('0.8.0')).toBe(false);
        expect(supportsShellPane('0.8.9')).toBe(false);
        expect(supportsShellPane('0.4.2')).toBe(false);
    });

    it('compares minors numerically, not lexically', () => {
        // '0.10.0' < '0.9.0' as strings — the bug this guards.
        expect(supportsShellPane('0.10.0')).toBe(true);
        expect(supportsShellPane('0.100.0')).toBe(true);
    });

    it('treats a prerelease of the minimum as supported', () => {
        expect(supportsShellPane('0.9.0-beta.1')).toBe(true);
        expect(supportsShellPane('v0.9.0+build.7')).toBe(true);
    });

    it('refuses anything it cannot confirm', () => {
        // Asymmetric cost: a false negative is the plain banner, a false
        // positive is a stack trace on first paint.
        expect(supportsShellPane(undefined)).toBe(false);
        expect(supportsShellPane('')).toBe(false);
        expect(supportsShellPane('next')).toBe(false);
        expect(supportsShellPane('0.9')).toBe(false);
    });
});
