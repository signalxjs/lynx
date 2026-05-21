/**
 * JSX intrinsic type augmentation for Lynx's `<x-markdown>` XElement.
 *
 * Importing this module registers `'x-markdown'` as a valid JSX intrinsic
 * with its 3.7.0+ attributes and events. Pulled in automatically by
 * `@sigx/lynx-markdown`'s entry point so consumers do not need to import
 * it directly.
 *
 * The native element ships per-platform on different schedules:
 *   - Harmony: available since 3.7.0
 *   - Android: available since 3.8.0-rc.0 (artifact `lynx_xelement_markdown`)
 *   - iOS:     not yet in any tagged release; lands on the main branch
 *               post-3.8.0
 *
 * `<x-markdown>` props in JSX still type-check on every platform. At
 * runtime the SignalX renderer issues a `__CreateElement('x-markdown')`
 * op unconditionally; on platforms where the native element is not
 * registered, the underlying engine handles the unknown tag (today it
 * logs a warning and emits no view). There is no JS-side feature gate
 * in this package — once you upgrade to a Lynx release that ships the
 * element on your target platforms, rendering activates automatically.
 */
import type { LynxCommonAttributes, LynxEventHandler } from '@sigx/lynx-runtime';

/** Detail payload of `bindlink` — the engine ships `url` plus optional fields. */
export interface MarkdownLinkEventDetail {
    url: string;
    [k: string]: unknown;
}
export interface MarkdownLinkEvent {
    type: 'link';
    detail: MarkdownLinkEventDetail;
}

/** Detail payload of `bindimageTap`. */
export interface MarkdownImageTapEventDetail {
    src: string;
    [k: string]: unknown;
}
export interface MarkdownImageTapEvent {
    type: 'imageTap';
    detail: MarkdownImageTapEventDetail;
}

/** Detail payload of `bindparseEnd`. */
export interface MarkdownParseEndEventDetail {
    [k: string]: unknown;
}
export interface MarkdownParseEndEvent {
    type: 'parseEnd';
    detail: MarkdownParseEndEventDetail;
}

export interface XMarkdownAttributes extends LynxCommonAttributes {
    /**
     * Raw markdown source. Lynx parses the first text child of
     * `<x-markdown>` per the 3.7.0 raw-text-node optimization. Passing a
     * single string here is the common path; JSX expressions resolving to
     * a string also work.
     */
    children?: any;
    /**
     * Render-time effect applied to the parsed markdown output.
     * Known values: `'typewriter'`, `'none'`. The engine treats unknown
     * strings as `'none'`.
     */
    'markdown-effect'?: string;
    /**
     * Inline view attachments referenced by markdown text marks. Shape is
     * engine-defined; passed through as-is.
     */
    'text-mark-attachments'?: ReadonlyArray<unknown>;
    /** Fires when the user taps an `[anchor](url)` link. */
    bindlink?: LynxEventHandler<MarkdownLinkEvent>;
    /** Fires when the user taps an inline image. */
    bindimageTap?: LynxEventHandler<MarkdownImageTapEvent>;
    /** Fires once the engine finishes parsing the source. */
    bindparseEnd?: LynxEventHandler<MarkdownParseEndEvent>;
}

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'x-markdown': XMarkdownAttributes;
        }
    }
}

export {};
