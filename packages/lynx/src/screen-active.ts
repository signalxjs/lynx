import { defineInjectable, defineProvide } from '@sigx/runtime-core';

/**
 * Is the screen this component belongs to the one the user sees? (#1308)
 *
 * A navigator keeps a covered screen MOUNTED: push a screen, and the one
 * underneath stays alive with its state. Most of its UI is hidden by the
 * screen on top, but not everything. An overlay renders into a
 * `position: fixed` outlet that paints above the whole page, and a layer
 * that listens for the back button is global. Such a surface has to know
 * when its own screen is covered, so it can hide and stop claiming back.
 *
 * The contract lives here, not in `@sigx/lynx-navigation`, because the
 * packages that read it (`@sigx/lynx-zero`) take navigation only as an
 * optional peer. A navigator provides the signal for each screen it
 * renders; without one, every component reports active.
 *
 * The returned function is a reactive read: call it inside an effect or a
 * render and it re-runs when the screen is covered or uncovered.
 *
 * @example
 * ```tsx
 * const active = useScreenActive();
 * effect(() => {
 *     if (active()) startPolling();
 *     else stopPolling();
 * });
 * ```
 */
export type ScreenActive = () => boolean;

const ALWAYS_ACTIVE: ScreenActive = () => true;

/**
 * Read the calling component's screen activity. Call it in setup. Outside
 * any navigator screen it returns a function that is always `true`.
 */
export const useScreenActive = defineInjectable<ScreenActive>(() => ALWAYS_ACTIVE);

/**
 * Provide the screen activity for this component's subtree. Navigators call
 * it once per screen they render. It is ANDed with the enclosing value, so a
 * screen inside a nested navigator is only active while its host screen is.
 * Call it in setup.
 */
export function provideScreenActive(active: ScreenActive): void {
    const outer = useScreenActive();
    const combined: ScreenActive = outer === ALWAYS_ACTIVE ? active : () => outer() && active();
    defineProvide(useScreenActive, () => combined);
}
