/**
 * Headless tabs selection — the shared behavior behind every design system's
 * `Tabs`/`Tab` pair (extracted once daisy and hero both duplicated it; the
 * #219 pilot was the evidence gate).
 *
 * The DS's `Tabs` container provides a `TabsSelection` built from its
 * `activeTab`/`onChange` props; each `Tab` injects it to derive its active
 * state from its `value` and to report presses. Explicit per-tab
 * `active`/`onPress` props take precedence in the DS components, so the
 * fully-controlled per-tab style keeps working.
 *
 * Reactivity: `provideTabsSelection` is called once at the container's setup
 * with *getters* into the container's reactive props, so `isActive()` reads
 * track the current `activeTab` value on every render.
 */
import { defineInjectable, defineProvide } from '@sigx/lynx';

export interface TabsSelection {
  /** Whether the tab with this `value` is the selected one. Reactive. */
  isActive(value: string): boolean;
  /** Report a press on the tab with this `value` (drives `onChange`). */
  select(value: string): void;
}

const NO_SELECTION: TabsSelection = {
  isActive: () => false,
  select: () => {},
};

/**
 * Inject the nearest enclosing `Tabs` container's selection. Outside any
 * container this resolves to an inert selection (never active, presses
 * no-op), so a bare `Tab` driven purely by `active`/`onPress` still works.
 */
export const useTabsSelection = defineInjectable<TabsSelection>(() => NO_SELECTION);

/**
 * Provide a selection for the subtree. Call from the DS `Tabs` container's
 * setup with getters into its reactive props:
 *
 * ```ts
 * provideTabsSelection(
 *   () => props.activeTab,
 *   (v) => props.onChange?.(v),
 * );
 * ```
 */
export function provideTabsSelection(
  getActive: () => string | undefined,
  onSelect: (value: string) => void,
): void {
  const selection: TabsSelection = {
    isActive: (value) => getActive() === value,
    select: onSelect,
  };
  defineProvide(useTabsSelection, () => selection);
}
