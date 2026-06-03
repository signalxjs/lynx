import { component, type Define } from '@sigx/lynx';
import './jsx-augment.js';
import type {
    MarkdownLinkEvent,
    MarkdownImageTapEvent,
    MarkdownParseEndEvent,
} from './jsx-augment.js';

export type XMarkdownEffect = 'typewriter' | 'none' | (string & {});

export type XMarkdownProps =
    & Define.Prop<'value', string, false>
    & Define.Prop<'effect', XMarkdownEffect, false>
    & Define.Prop<'attachments', ReadonlyArray<unknown>, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', string | Record<string, string | number>, false>
    & Define.Prop<'onLink', (e: MarkdownLinkEvent) => void, false>
    & Define.Prop<'onImageTap', (e: MarkdownImageTapEvent) => void, false>
    & Define.Prop<'onParseEnd', (e: MarkdownParseEndEvent) => void, false>;

/**
 * Render a markdown document using Lynx's native `<x-markdown>` XElement.
 *
 * This is the thin wrapper over the platform's native markdown element. It is
 * fast where available but platform-gated (Harmony 3.7.0+, Android 3.8.0-rc.0+,
 * iOS not yet in a tagged release) and opaque — the engine owns parsing and
 * styling. For a cross-platform, fully-controllable, streaming-aware renderer
 * built on Lynx `<view>`/`<text>` primitives, use {@link Markdown} instead.
 *
 * The markdown source is passed via the `value` prop; it is delivered to the
 * native element as a raw-text child (per the 3.7.0 "raw-text node
 * optimization" path). Event props use signalx's automatic
 * `onLink`→`bindlink` mapping in `nodeOps.parseEventProp`, so handlers wire
 * up without any per-event glue.
 *
 * @example
 * ```tsx
 * <XMarkdown
 *   value={"# Hello\n\nThis is **markdown**."}
 *   effect="typewriter"
 *   onLink={(e) => console.log('tapped', e.detail.url)}
 * />
 * ```
 *
 * @remarks
 * Availability of the `<x-markdown>` element is platform-dependent — see
 * `jsx-augment.ts` for the per-platform schedule. On platforms where the
 * native element is not registered, the engine logs a warning and renders
 * no view; there is no JS-side feature gate.
 */
export const XMarkdown = component<XMarkdownProps>(({ props }) => {
    return () => (
        <x-markdown
            markdown-effect={props.effect}
            text-mark-attachments={props.attachments}
            class={props.class}
            style={props.style}
            bindlink={props.onLink}
            bindimageTap={props.onImageTap}
            bindparseEnd={props.onParseEnd}
        >
            {props.value ?? ''}
        </x-markdown>
    );
});
