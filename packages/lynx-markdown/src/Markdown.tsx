import { component, type Define } from '@sigx/lynx';
import './jsx-augment';
import type {
    MarkdownLinkEvent,
    MarkdownImageTapEvent,
    MarkdownParseEndEvent,
} from './jsx-augment';

export type MarkdownEffect = 'typewriter' | 'none' | (string & {});

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
 * native element is not registered, the engine logs a warning and renders
 * no view; there is no JS-side feature gate.
 */
export const Markdown = component<MarkdownProps>(({ props }) => {
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
