/**
 * Test-host directives.
 *
 * The real `@sigx/lynx-runtime` `show` directive pushes a `SET_STYLE` op through
 * the background op queue and operates on a `ShadowElement` — it can't drive a
 * `TestNode`. This is the `show` directive for the in-memory test host: it
 * toggles the node's effective style directly so `use:show` is observable in the
 * test tree. The test renderer overrides the global `show` registration with
 * this one (see `test-renderer.ts`), so `use:show` resolves here under test.
 *
 * The directive *lifecycle* (created/mounted/updated/unmounted, resolution,
 * state) is the shared, host-agnostic runtime from `@sigx/lynx-runtime`; only
 * this definition is test-host specific.
 */
import { defineDirective } from '@sigx/lynx';
import { TestNode } from './test-node.js';

function applyTestVisibility(el: TestNode, visible: boolean): void {
  el._vShowHidden = !visible;
  el._applyStyle();
}

/** `use:show` for the test host — toggles `display:none` on the TestNode. */
export const testShow = defineDirective<boolean, TestNode>({
  mounted(el, { value }) {
    applyTestVisibility(el, !!value);
  },
  updated(el, { value, oldValue }) {
    if (value !== oldValue) applyTestVisibility(el, !!value);
  },
  unmounted(el) {
    // Restore visibility — matches the real directive: removing `use:show`
    // while the node stays mounted must clear a lingering display:none.
    applyTestVisibility(el, true);
  },
});
