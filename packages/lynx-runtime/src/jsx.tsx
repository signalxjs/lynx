/**
 * Lynx JSX intrinsic element type definitions for SignalX.
 *
 * Importing this file (which happens automatically when you import
 * `@sigx/lynx-runtime`) globally augments `JSX.IntrinsicElements` so
 * that <view>, <text>, <image>, <scroll-view>, <list>, <list-item>,
 * <input>, <textarea>, <page>, <svg>, <filter-image> are recognised
 * with their proper attribute types.
 *
 * Same pattern as packages/runtime-dom/src/jsx.tsx (DOM elements) and
 * packages/runtime-terminal/src/index.ts (<box>/<text>/<br>).
 *
 * Hybrid web+lynx codebases that import both @sigx/runtime-dom and
 * @sigx/lynx-runtime will hit a TypeScript merge error on <input>
 * because runtime-dom declares it via InputHTMLAttributes and we
 * declare it via InputAttributes. Pick one platform per app or alias
 * the imports — see lynx-runtime README for details.
 */

import type { Model } from '@sigx/runtime-core';
import type { MainThreadRef } from './main-thread-ref';

// ---------------------------------------------------------------------------
// Common Lynx event handler types
// ---------------------------------------------------------------------------

export type LynxEventHandler<E = any> = (event: E) => void;

// ---------------------------------------------------------------------------
// MainThread namespace — types for use in main-thread event handlers
// ---------------------------------------------------------------------------

export namespace MainThread {
  /** Element handle available in main-thread event handlers via MainThreadRef.current. */
  export interface Element {
    setStyleProperties(styles: Record<string, string | number>): void;
    setStyleProperty(name: string, value: string | number): void;
    getComputedStyleProperty(name: string): string;
    animate(
      keyframes: Array<Record<string, string | number>>,
      options?: {
        duration?: number;
        delay?: number;
        iterations?: number;
        direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
        easing?: string;
        fill?: 'none' | 'forwards' | 'backwards' | 'both';
        name?: string;
      },
    ): { play(): void; pause(): void; cancel(): void } | null;
    setAttribute(key: string, value: unknown): void;
    /**
     * Invoke a UI method exposed by the underlying native element (e.g.
     * `scrollBy`, `scrollTo`, `autoScroll` on `<scroll-view>`). The
     * returned promise resolves with the method's data payload on
     * success; rejects with an Error otherwise.
     */
    invoke(methodName: string, params?: Record<string, unknown>): Promise<unknown>;
  }
}

// ---------------------------------------------------------------------------
// Common attributes shared by all Lynx elements
// ---------------------------------------------------------------------------

export interface LynxCommonAttributes {
    /** Unique identifier */
    id?: string;
    /** CSS class name(s) */
    class?: string;
    /** Inline styles (string or object) */
    style?: string | Record<string, string | number>;
    /** Ref callback */
    ref?: (el: any) => void;
    /** Key for reconciliation */
    key?: string | number | null;
    /** Flatten (performance hint) */
    flatten?: boolean;
    /** Accessibility label */
    'accessibility-label'?: string;
    /** Accessibility role */
    'accessibility-role'?: string;
    /** Whether element is accessibility element */
    'accessibility-element'?: boolean;
    /**
     * Cause Lynx's touch handler to claim the touch from external UIKit /
     * Android gestures (e.g. an ancestor `<scroll-view>`'s native pan) while
     * the touch is on this element, by reporting itself as a higher-priority
     * recognizer that external gestures must wait on. Useful for `bindtap`
     * targets that sit inside a scroll container; **note that this routes
     * the touch through Lynx's bind-event path and bypasses the new gesture
     * arena**, so it does NOT compose with `useGestureDetector` /
     * `Gesture.*()` in the way you might expect.
     */
    'block-native-event'?: boolean;
    /**
     * Block native gestures only inside specific rectangular sub-regions of
     * this element. Each entry is `[x, y, width, height]` with CSS-string
     * units (e.g. `'30px'` or `'50%'`). Same arena-bypass caveat as
     * `block-native-event`.
     */
    'block-native-event-areas'?: ReadonlyArray<readonly [string, string, string, string]>;

    // Common Lynx event bindings
    bindtap?: LynxEventHandler;
    catchtap?: LynxEventHandler;
    bindlongpress?: LynxEventHandler;
    catchlongpress?: LynxEventHandler;
    bindtouchstart?: LynxEventHandler;
    catchtouchstart?: LynxEventHandler;
    bindtouchmove?: LynxEventHandler;
    catchtouchmove?: LynxEventHandler;
    bindtouchend?: LynxEventHandler;
    catchtouchend?: LynxEventHandler;
    bindtouchcancel?: LynxEventHandler;
    catchtouchcancel?: LynxEventHandler;

    // sigx event handler aliases (onX style)
    onTap?: LynxEventHandler;
    onLongpress?: LynxEventHandler;
    onTouchstart?: LynxEventHandler;
    onTouchmove?: LynxEventHandler;
    onTouchend?: LynxEventHandler;
    onTouchcancel?: LynxEventHandler;

    // -----------------------------------------------------------------------
    // Main Thread Script (MTS) attributes
    // -----------------------------------------------------------------------

    /** Bind a MainThreadRef to this element for synchronous MT access. */
    'main-thread:ref'?: MainThreadRef<MainThread.Element | null>;

    // Main-thread event bindings — handlers execute on MT, zero thread crossing.
    'main-thread-bindtap'?: LynxEventHandler;
    'main-thread-catchtap'?: LynxEventHandler;
    'main-thread-bindtouchstart'?: LynxEventHandler;
    'main-thread-catchtouchstart'?: LynxEventHandler;
    'main-thread-bindtouchmove'?: LynxEventHandler;
    'main-thread-catchtouchmove'?: LynxEventHandler;
    'main-thread-bindtouchend'?: LynxEventHandler;
    'main-thread-catchtouchend'?: LynxEventHandler;
    'main-thread-bindtouchcancel'?: LynxEventHandler;
    'main-thread-catchtouchcancel'?: LynxEventHandler;
    'main-thread-bindlongpress'?: LynxEventHandler;
    'main-thread-catchlongpress'?: LynxEventHandler;
    'main-thread-bindscroll'?: LynxEventHandler;
    'main-thread-catchscroll'?: LynxEventHandler;

    // No `[key: string]: any` catch-all here. `data-*` / `aria-*` come in via
    // the global `JSX.IntrinsicAttributes` template-literal index signatures.
    // If a legitimate attribute is missing from this interface, add it
    // explicitly — that's the whole point of typing.
}

// ---------------------------------------------------------------------------
// Element-specific attribute interfaces
// ---------------------------------------------------------------------------

export interface ViewAttributes extends LynxCommonAttributes {
    children?: any;
}

export interface TextAttributes extends LynxCommonAttributes {
    children?: any;
    /** Max number of lines before truncation */
    'number-of-lines'?: number;
    /** Text overflow mode */
    'text-overflow'?: 'clip' | 'ellipsis';
    /** Selectable text */
    selectable?: boolean;
}

export interface ImageAttributes extends LynxCommonAttributes {
    /** Image source URI */
    src?: string;
    /** Placeholder image URI */
    placeholder?: string;
    /** Resize mode */
    mode?: 'cover' | 'contain' | 'stretch' | 'center' | 'repeat' | 'aspectFit' | 'aspectFill';
    /** Alt text for accessibility */
    alt?: string;
    /** Lazy loading */
    'lazy-load'?: boolean;
    /** Auto-size: image element resizes to fit the image content */
    'auto-size'?: boolean;

    bindload?: LynxEventHandler;
    binderror?: LynxEventHandler;
    onLoad?: LynxEventHandler;
    onError?: LynxEventHandler;
}

export interface ScrollViewAttributes extends LynxCommonAttributes {
    children?: any;
    /** Scroll direction */
    'scroll-orientation'?: 'vertical' | 'horizontal';
    /** Enable horizontal scrolling (legacy; modern Lynx uses `scroll-orientation`). */
    'scroll-x'?: boolean;
    /** Enable vertical scrolling (legacy; modern Lynx uses `scroll-orientation`). */
    'scroll-y'?: boolean;
    /**
     * Toggle native scroll/drag responsiveness at runtime. Use this (not
     * `scroll-y`/`scroll-x`) to lock scrolling dynamically, e.g. while a
     * child gesture has the touch. Lynx 1.4+.
     */
    'enable-scroll'?: boolean;
    /** Scroll position (x) */
    'scroll-left'?: number;
    /** Scroll position (y) */
    'scroll-top'?: number;
    /** Enable scroll-to-upper/lower events */
    'upper-threshold'?: number;
    'lower-threshold'?: number;
    /** Bounce on edges (iOS) */
    bounces?: boolean;
    /** Show scroll indicator */
    'show-scrollbar'?: boolean;
    /** Enable paging */
    'paging-enabled'?: boolean;

    bindscroll?: LynxEventHandler;
    bindscrolltoupper?: LynxEventHandler;
    bindscrolltolower?: LynxEventHandler;
    onScroll?: LynxEventHandler;
    onScrolltoupper?: LynxEventHandler;
    onScrolltolower?: LynxEventHandler;
}

export interface ListAttributes extends LynxCommonAttributes {
    children?: any;
    /** Scroll direction */
    'scroll-orientation'?: 'vertical' | 'horizontal';
    /** Number of columns for grid layout */
    'span-count'?: number;
    /** List type */
    'list-type'?: 'single' | 'flow' | 'waterfall';
    /** Snap items to edges */
    'item-snap'?: 'start' | 'center' | 'end' | 'none';
    /** Sticky header offset from top */
    'sticky-top'?: number;
    /** Sticky footer offset from bottom */
    'sticky-bottom'?: number;

    bindscroll?: LynxEventHandler;
    bindscrolltoupper?: LynxEventHandler;
    bindscrolltolower?: LynxEventHandler;
    onScroll?: LynxEventHandler;
    onScrolltoupper?: LynxEventHandler;
    onScrolltolower?: LynxEventHandler;
}

export interface ListItemAttributes extends LynxCommonAttributes {
    children?: any;
    /** Item type for recycling (items with same item-type share a view pool) */
    'item-type'?: string | number;
    /** Sticky offset from top */
    'sticky-top'?: number;
    /** Sticky offset from bottom */
    'sticky-bottom'?: number;
    /** Whether this item is full-span in a grid list */
    'full-span'?: boolean;
}

export interface InputAttributes extends LynxCommonAttributes {
    /** Current value */
    value?: string;
    /** Placeholder text */
    placeholder?: string;
    /** Input type */
    type?: 'text' | 'number' | 'password' | 'digit' | 'idcard';
    /** Maximum character length */
    maxlength?: number;
    /** Whether the input is disabled */
    disabled?: boolean;
    /** Auto-focus on mount */
    focus?: boolean;
    /** Confirm button type */
    'confirm-type'?: 'send' | 'search' | 'next' | 'go' | 'done';

    /**
     * Two-way binding via sigx model directive.
     * Pass a getter function: `<input model={() => state.name} />`.
     * Handled by the platform model processor in
     * `packages/lynx-runtime/src/model-processor.ts`.
     */
    model?: (() => string) | Model<string>;
    /** Forwarded model update handler (set by the platform model processor) */
    'onUpdate:modelValue'?: (value: string) => void;

    bindinput?: LynxEventHandler;
    bindblur?: LynxEventHandler;
    bindfocus?: LynxEventHandler;
    bindconfirm?: LynxEventHandler;
    onInput?: LynxEventHandler;
    onBlur?: LynxEventHandler;
    onFocus?: LynxEventHandler;
    onConfirm?: LynxEventHandler;
}

export interface TextAreaAttributes extends LynxCommonAttributes {
    /** Current value */
    value?: string;
    /** Placeholder text */
    placeholder?: string;
    /** Maximum character length */
    maxlength?: number;
    /** Whether the textarea is disabled */
    disabled?: boolean;
    /** Auto-focus on mount */
    focus?: boolean;
    /** Whether to auto-grow height */
    'auto-height'?: boolean;

    /**
     * Two-way binding via sigx model directive.
     * Pass a getter function: `<textarea model={() => state.notes} />`.
     */
    model?: (() => string) | Model<string>;
    /** Forwarded model update handler (set by the platform model processor) */
    'onUpdate:modelValue'?: (value: string) => void;

    bindinput?: LynxEventHandler;
    bindblur?: LynxEventHandler;
    bindfocus?: LynxEventHandler;
    onInput?: LynxEventHandler;
    onBlur?: LynxEventHandler;
    onFocus?: LynxEventHandler;
}

export interface PageAttributes extends LynxCommonAttributes {
    children?: any;
}

export interface SvgAttributes extends LynxCommonAttributes {
    /**
     * Raw SVG markup as a string — Lynx's `<svg>` element renders this
     * natively (the engine parses the inline XML). Per the Lynx docs the
     * element does NOT accept JSX/React children; pass everything via
     * `content` or `src`.
     *
     * @example
     * ```tsx
     * <svg content='<svg viewBox="0 0 24 24"><path d="…" fill="currentColor"/></svg>'
     *      style={{ width: 24, height: 24 }} />
     * ```
     */
    content?: string;
    /** URL to an external SVG resource (alternative to `content`). */
    src?: string;
    /** SVG width — usually preferable to control sizing via `style`. */
    width?: number | string;
    /** SVG height — usually preferable to control sizing via `style`. */
    height?: number | string;
    /** SVG viewBox — only relevant when `content` is omitted (otherwise the inline `<svg>` carries its own viewBox). */
    viewBox?: string;
}

export interface FilterImageAttributes extends LynxCommonAttributes {
    /** Source image URI */
    src?: string;
    /** Filter type (e.g. blur, brightness) */
    filter?: string;
    /** Resize mode */
    mode?: 'cover' | 'contain' | 'stretch' | 'center';

    bindload?: LynxEventHandler;
    binderror?: LynxEventHandler;
    onLoad?: LynxEventHandler;
    onError?: LynxEventHandler;
}

// ---------------------------------------------------------------------------
// Global JSX namespace augmentation
//
// Importing @sigx/lynx-runtime is enough to get typed JSX completion for
// every Lynx intrinsic element. Same pattern runtime-dom and runtime-terminal
// use — types ship with the runtime that consumes them, no separate package.
// ---------------------------------------------------------------------------

// `data-*` / `aria-*` declared as a mapped type rather than two index
// signatures: the @typescript/native-preview (tsgo) compiler currently
// flags two template-literal index signatures on the same interface as
// TS2374 duplicates, and also rejects the union form
// `[key: \`data-${string}\` | \`aria-${string}\`]` for the same reason.
// A `Record<K, V>` extension produces a mapped type instead, which tsgo
// accepts. Declared at module scope (not inside JSX namespace) so the
// emitted .d.ts doesn't double-declare it across consumers.
type DataAriaAttributes = Record<`data-${string}` | `aria-${string}`, unknown>;

declare global {
    namespace JSX {
        /**
         * Cross-cutting attributes valid on every JSX element (intrinsic + components).
         *
         * **The presence of this declaration is what enables TypeScript's component
         * prop excess-property checking.** Without it, TS falls back to a permissive
         * default and silently accepts any prop on any sigx component — typo'd event
         * names like `bindDragEnd` (vs the correct `onDragEnd`) compile clean.
         * Mirrors `@sigx/runtime-dom`'s declaration; tuned for Lynx's attribute set.
         *
         * No `[key: string]: any` catch-all here on purpose — that would re-disable
         * the prop checks. `data-*` / `aria-*` are scoped via template-literal types.
         */
        interface IntrinsicAttributes extends DataAriaAttributes {
            /** Stable identity for list reconciliation. */
            key?: string | number | null;
            id?: string;
            class?: string;
            style?: Record<string, string | number>;
        }

        interface IntrinsicElements {
            view: ViewAttributes;
            text: TextAttributes;
            image: ImageAttributes;
            'scroll-view': ScrollViewAttributes;
            list: ListAttributes;
            'list-item': ListItemAttributes;
            input: InputAttributes;
            textarea: TextAreaAttributes;
            page: PageAttributes;
            svg: SvgAttributes;
            'filter-image': FilterImageAttributes;
        }
    }
}

// Make this file a module so the `declare global` block applies on import.
export {};
