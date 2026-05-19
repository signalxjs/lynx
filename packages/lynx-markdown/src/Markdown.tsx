import { component, type Define } from '@sigx/lynx';
import './jsx-augment';

export type MarkdownEffect = 'typewriter' | 'none' | (string & {});

/** Detail payload of `bindlink` — the engine ships `url` plus optional fields. */
export interface MarkdownLinkEventDetail {
    url: string;
    [k: string]: unknown;
}
export type MarkdownLinkEvent = { type: 'link'; detail: MarkdownLinkEventDetail };

/** Detail payload of `bindimageTap`. */
export interface MarkdownImageTapEventDetail {
    src: string;
    [k: string]: unknown;
}
export type MarkdownImageTapEvent = { type: 'imageTap'; detail: MarkdownImageTapEventDetail };

/** Detail payload of `bindparseEnd`. */
export interface MarkdownParseEndEventDetail {
    [k: string]: unknown;
}
export type MarkdownParseEndEvent = { type: 'parseEnd'; detail: MarkdownParseEndEventDetail };

export type MarkdownProps =
    & Define.Prop<'value', string, false>
    & Define.Prop<'effect', MarkdownEffect, false>
    & Define.Prop<'attachments', ReadonlyArray<unknown>, false>
    & Define.Prop<'class', string, false>
    & Define.Prop<'style', string | Record<string, string | number>, false>
    & Define.Prop<'onLink', (e: MarkdownLinkEvent) => void, false>
    & Define.Prop<'onImageTap', (e: MarkdownImageTapEvent) => void, false>
    & Define.Prop<'onParseEnd', (e: MarkdownParseEndEvent) => void, false>;

/**
 * Render a markdown document using Lynx's `<x-markdown>` XElement.
 *
 * The markdown source is passed via the `value` prop; it is delivered to the
 * native element as a raw-text child (per the 3.7.0 "raw-text node
 * optimization" path). Event props use signalx's automatic
 * `onLink`→`bindlink` mapping in `nodeOps.parseEventProp`, so handlers wire
 * up without any per-event glue.
 *
 * @example
 * ```tsx
 * <Markdown
 *   value={"# Hello\n\nThis is **markdown**."}
 *   effect="typewriter"
 *   onLink={(e) => console.log('tapped', e.detail.url)}
 * />
 * ```
 *
 * @remarks
 * Availability of the `<x-markdown>` element is platform-dependent — see
 * `jsx-augment.ts` for the per-platform schedule. On platforms where the
 * native element is not registered, the component renders nothing.
 */
export const Markdown = component<MarkdownProps>(({ props }) => {
    return () => (
        <x-markdown
            markdown-effect={props.effect}
            text-mark-attachments={props.attachments}
            class={props.class}
            style={props.style}
            bindlink={props.onLink as never}
            bindimageTap={props.onImageTap as never}
            bindparseEnd={props.onParseEnd as never}
        >
            {props.value ?? ''}
        </x-markdown>
    );
});
