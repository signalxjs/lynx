/**
 * A screen-scoped zero theme (#1313). A root `ThemeProvider` binds the global
 * theme, so two stacked screens whose ZeroRoots are both roots share it: a
 * dark screen pushed over a light one seeds the global theme dark, and the
 * light screen comes back dark when the dark one pops. Wrapping each screen's
 * ZeroRoot in a pin-free root provider makes the ZeroRoot a nested provider
 * with local state: its theme lives and dies with its screen.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render } from '@sigx/lynx-testing';
import type { TestNode } from '@sigx/lynx-testing';
import { ThemeProvider, ZeroRoot, registerTheme, themeController } from '../src/index';

/** The host view of the innermost provider in a tree (the ZeroRoot's). */
function innermostHost(root: TestNode): TestNode | null {
    let found: TestNode | null = null;
    const walk = (n: TestNode): void => {
        if ((n._class ?? '').includes('zx-root')) found = n;
        for (const child of n.children) walk(child);
    };
    walk(root);
    return found;
}

describe('a ZeroRoot nested under a pin-free root provider (#1313)', () => {
    beforeEach(() => {
        registerTheme({ name: 'ss-light', colorScheme: 'light' });
        registerTheme({ name: 'ss-dark', colorScheme: 'dark' });
        themeController.set('ss-light');
    });

    it('the old shape leaks: a root ZeroRoot pinned dark writes the global theme', () => {
        const index = render(<ZeroRoot initial="ss-light"><text>index</text></ZeroRoot>);
        render(<ZeroRoot initial="ss-dark"><text>section</text></ZeroRoot>);
        expect(themeController.name).toBe('ss-dark');
        // The index binds the same global state.
        expect(innermostHost(index.container)!._class).toContain('ss-dark');
    });

    it('a stacked dark screen keeps its theme local; the screen under it stays light', () => {
        const index = render(
            <ThemeProvider><ZeroRoot initial="ss-light"><text>index</text></ZeroRoot></ThemeProvider>,
        );
        const section = render(
            <ThemeProvider><ZeroRoot initial="ss-dark"><text>section</text></ZeroRoot></ThemeProvider>,
        );
        expect(themeController.name).toBe('ss-light');
        expect(innermostHost(section.container)!._class).toContain('ss-dark');
        expect(innermostHost(index.container)!._class).toContain('ss-light');
        expect(innermostHost(index.container)!._class).not.toContain('ss-dark');
        // The pop.
        section.unmount();
        expect(themeController.name).toBe('ss-light');
        expect(innermostHost(index.container)!._class).toContain('ss-light');
    });
});
