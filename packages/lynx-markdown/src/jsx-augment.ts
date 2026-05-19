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
 * `<x-markdown>` props in JSX still type-check on platforms where the
 * native element is not registered — they just render nothing at runtime.
 */
import type { LynxCommonAttributes, LynxEventHandler } from '@sigx/lynx-runtime';

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
    bindlink?: LynxEventHandler;
    /** Fires when the user taps an inline image. */
    bindimageTap?: LynxEventHandler;
    /** Fires once the engine finishes parsing the source. */
    bindparseEnd?: LynxEventHandler;
}

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'x-markdown': XMarkdownAttributes;
        }
    }
}

export {};
