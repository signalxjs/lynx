/**
 * `<sigx-touch-guard>` — **web** implementation of the native touch-guard
 * element.
 *
 * On Android the native element ([SigxTouchGuardView.kt]) consumes the
 * platform touch stream so a native input (EditText) under an overlay dim
 * can't grab focus (#787). DOM overlays don't leak touches — a positioned
 * element naturally shadows what's below it — so on web the tag only needs
 * to exist as a plain block container that hosts the overlay's children.
 * `guard-enabled` is accepted (observed for attribute symmetry) but changes
 * nothing.
 *
 * ## Where this runs
 *
 * web-core's `__CreateElement` does `document.createElement('sigx-touch-guard')`
 * in the **host page's main document**, so this element is
 * `customElements.define`'d there — served + imported by the generated host
 * page (`sigx run:web` / `build:web`). It is deliberately **import-free at
 * runtime** so the built `dist/web/element.js` is a self-contained ESM module
 * the host page can load without a bundler (same constraint as
 * `@sigx/lynx-richtext`'s web element).
 */

const TAG = 'sigx-touch-guard';

// Extend a real `HTMLElement` in the browser, but fall back to a dummy base so
// this module can be imported in a non-DOM context (a vitest suite, a
// bundler's SSR pass) without `class extends undefined` throwing at load.
const HTMLElementBase: typeof HTMLElement =
  typeof HTMLElement !== 'undefined'
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

export class SigxTouchGuardElement extends HTMLElementBase {
  static get observedAttributes(): string[] {
    return ['guard-enabled'];
  }

  connectedCallback(): void {
    // A plain block container, like the native element hosting its Lynx
    // children. No touch consumption needed on web (see module doc).
    this.style.display = this.style.display || 'block';
  }
}

export function defineSigxTouchGuard(): void {
  if (typeof customElements === 'undefined') return;
  if (!customElements.get(TAG)) customElements.define(TAG, SigxTouchGuardElement);
}

defineSigxTouchGuard();
