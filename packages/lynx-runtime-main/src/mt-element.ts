/**
 * MainThread element wrapper — provides a high-level API over raw PAPI
 * element handles for use in main-thread event handlers.
 *
 * When a MainThreadRef's `.current` is set, it receives one of these
 * wrappers so user code can call:
 *   - setStyleProperties({ transform: '...' })
 *   - getComputedStyleProperty('width')
 *   - animate(keyframes, options)
 *
 * These methods call Lynx PAPI directly on the main thread — no cross-thread
 * round-trip, enabling zero-latency UI updates.
 */

// ---------------------------------------------------------------------------
// Animation types
// ---------------------------------------------------------------------------

export interface AnimationKeyframe {
  [property: string]: string | number;
}

export interface AnimationOptions {
  duration?: number;
  delay?: number;
  iterations?: number;
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  easing?: string;
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
  name?: string;
  'play-state'?: 'running' | 'paused';
}

export interface Animation {
  play(): void;
  pause(): void;
  cancel(): void;
}

// ---------------------------------------------------------------------------
// MTElementWrapper
// ---------------------------------------------------------------------------

/**
 * Module-level latch that microtask-debounces `__FlushElementTree()` across
 * every MTElementWrapper write within a single microtask. Mirrors the
 * pattern in upstream `@lynx-js/react`'s `Element` class
 * (`runtime/lib/worklet-runtime/api/element.js`):
 *
 *   - First write in a microtask: schedule one Promise-microtask to flush.
 *   - Subsequent writes (same wrapper or any other) before the microtask
 *     fires: no-op (`willFlush` is already `true`).
 *   - Microtask runs: clear the latch, call the (animated-bridge-wrapped)
 *     `__FlushElementTree()` exactly once.
 *
 * Why the latch is module-level, not per-instance: a single tick often
 * touches multiple element wrappers (e.g. `<Draggable>` writes its own
 * transform AND issues `scrollBy` on the parent `<scroll-view>`). Two
 * wrappers, two writes, but the native flush is a tree-wide operation —
 * coalescing them into one is the whole point.
 *
 * Without this debounce, each of `setStyleProperties` / `setStyleProperty`
 * / `setAttribute` / `invoke` was firing a synchronous
 * `__FlushElementTree()`, paying the full layout pass per-call. The
 * stutter showed up most obviously in the `<Draggable edgeScroll>` rAF
 * tick (one transform write + one scrollBy invoke = 2 flushes/frame).
 */
let willFlush = false;

export class MTElementWrapper {
  /** The raw PAPI element handle. */
  readonly _el: MainThreadElement;

  constructor(el: MainThreadElement) {
    this._el = el;
  }

  /**
   * Coalesce multiple element writes into a single `__FlushElementTree()`
   * call at the end of the current microtask. See `willFlush` doc for the
   * full rationale; mirrors `Element.flushElementTree` in upstream
   * `@lynx-js/react`.
   *
   * `__FlushElementTree` itself is wrapped by `animated-bridge-mt` to
   * apply pending `useAnimatedStyle` bindings before the native flush, so
   * the debounce automatically coalesces SV-binding application too.
   */
  flushElementTree(): void {
    if (willFlush) return;
    willFlush = true;
    void Promise.resolve().then(() => {
      willFlush = false;
      __FlushElementTree();
    });
  }

  /**
   * Synchronously update inline styles on this element.
   * This bypasses the BG→MT op queue — styles are applied immediately
   * on the main thread, making it ideal for scroll-driven animations.
   *
   * The native `__FlushElementTree` call is microtask-debounced (see
   * `flushElementTree`), so chaining multiple writes within one tick
   * pays for a single flush instead of one per call.
   *
   * @example
   * ```ts
   * ref.current?.setStyleProperties({
   *   transform: `translateX(${offset}px)`,
   *   opacity: `${1 - ratio}`,
   * });
   * ```
   */
  setStyleProperties(styles: Record<string, string | number>): void {
    __SetInlineStyles(this._el, styles);
    this.flushElementTree();
  }

  /**
   * Get a computed style property value from this element.
   *
   * @param name - CSS property name in kebab-case (e.g. 'background-color')
   * @returns The computed value as a string
   */
  getComputedStyleProperty(name: string): string {
    if (typeof __GetComputedStyleByKey === 'function') {
      return __GetComputedStyleByKey(this._el, name);
    }
    return '';
  }

  /**
   * Get a single attribute value by name. Returns the value as set via
   * `setAttribute` (or by a parent component); does not resolve aliases.
   */
  getAttribute(name: string): unknown {
    if (typeof __GetAttributeByName === 'function') {
      return __GetAttributeByName(this._el, name);
    }
    return undefined;
  }

  /**
   * Get the list of attribute names currently set on this element.
   */
  getAttributeNames(): string[] {
    if (typeof __GetAttributeNames === 'function') {
      return __GetAttributeNames(this._el);
    }
    return [];
  }

  /**
   * Find the first descendant element matching the CSS selector.
   * Mirrors `Element.prototype.querySelector` from the DOM.
   *
   * Returns `null` when no match is found OR when the host runtime does not
   * provide `__QuerySelector` (older Lynx SDKs).
   */
  querySelector(selector: string): MTElementWrapper | null {
    if (typeof __QuerySelector !== 'function') return null;
    const ref = __QuerySelector(this._el, selector, {});
    return ref ? new MTElementWrapper(ref) : null;
  }

  /**
   * Find every descendant element matching the CSS selector. Returns an empty
   * array when nothing matches OR when the host runtime does not provide
   * `__QuerySelectorAll`.
   */
  querySelectorAll(selector: string): MTElementWrapper[] {
    if (typeof __QuerySelectorAll !== 'function') return [];
    return __QuerySelectorAll(this._el, selector, {})
      .map((el) => new MTElementWrapper(el));
  }

  /**
   * Invoke a UI method exposed by the underlying native element (e.g.
   * `scrollIntoView` on `<scroll-view>`, `scrollToIndex` on `<list>`).
   *
   * Resolves with the method's `data` payload on success (`code === 0`);
   * rejects with an Error containing the JSON-stringified response otherwise.
   */
  invoke(methodName: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (typeof __InvokeUIMethod !== 'function') {
        reject(new Error('UI method invoke: __InvokeUIMethod not available'));
        return;
      }
      __InvokeUIMethod(this._el, methodName, params ?? {}, (res) => {
        if (res.code === 0) resolve(res.data);
        else reject(new Error('UI method invoke: ' + JSON.stringify(res)));
      });
      this.flushElementTree();
    });
  }

  /**
   * Start a keyframe animation on this element using the Lynx animation API.
   *
   * @param keyframes - Array of keyframe objects
   * @param options - Animation configuration
   * @returns Animation controller with play/pause/cancel methods
   *
   * @example
   * ```ts
   * ref.current?.animate(
   *   [{ opacity: 0 }, { opacity: 1 }],
   *   { duration: 300, easing: 'ease-in-out' }
   * );
   * ```
   */
  animate(
    keyframes: AnimationKeyframe[],
    options: AnimationOptions = {},
  ): Animation | null {
    const el = this._el as any;
    if (typeof el.animate === 'function') {
      return el.animate(keyframes, options) as Animation;
    }
    return null;
  }

  /**
   * Set a single attribute on this element. Microtask-debounced flush —
   * see `flushElementTree`.
   */
  setAttribute(key: string, value: unknown): void {
    __SetAttribute(this._el, key, value);
    this.flushElementTree();
  }

  /**
   * Set a single inline style property. Microtask-debounced flush — see
   * `flushElementTree`.
   */
  setStyleProperty(name: string, value: string | number): void {
    __AddInlineStyle(this._el, name, value);
    this.flushElementTree();
  }
}
