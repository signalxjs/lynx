/**
 * Background-thread command surface for `<sigx-richtext>`.
 *
 * Commands ride the `INVOKE_UI_METHOD` op (BG→MT, fire-and-forget — landed in
 * lynx-runtime#145): no `main-thread:ref` worklet plumbing is needed. Return
 * values are deliberately not part of this surface — state reconciles through
 * the element's `bindchange`/`bindselection` events, which is the editor's
 * single source of truth.
 *
 * The element handle is the ShadowElement delivered by a callback `ref`:
 *
 * ```tsx
 * let el: RichTextHandle = null;
 * <sigx-richtext ref={(e) => { el = e; }} … />
 * RichTextMethods.toggleFormat(el, 'bold');
 * ```
 */

import { OP, pushOp, scheduleFlush } from '@sigx/lynx';
import type { BlockAttrType, InlineSpanType, RichDoc } from './model/types.js';
import { encodeDoc } from './model/codec.js';

/** Minimal structural handle — the BG ShadowElement from a callback `ref`. */
export type RichTextHandle = { id: number } | null | undefined;

function invoke(el: RichTextHandle, method: string, params: Record<string, unknown>): void {
    if (!el) return;
    pushOp(OP.INVOKE_UI_METHOD, el.id, method, params);
    scheduleFlush();
}

export const RichTextMethods = {
    /**
     * Replace the document. Carries the version the write was based on —
     * native drops stale writes (`doc.v < localVersion`) and re-emits current
     * state, and rejects writes during an active IME composition.
     */
    setDocument(el: RichTextHandle, doc: RichDoc): void {
        invoke(el, 'setDocument', { doc: encodeDoc(doc) });
    },

    /** Toggle an inline format over the current selection (collapsed → flips typing attributes). */
    toggleFormat(el: RichTextHandle, type: InlineSpanType): void {
        invoke(el, 'toggleFormat', { type });
    },

    /** Set the block type of the paragraph(s) covering the current selection. */
    setBlockType(el: RichTextHandle, type: BlockAttrType, level?: number): void {
        invoke(el, 'setBlockType', { type, ...(level !== undefined ? { level } : {}) });
    },

    /** Insert text at the caret (inherits typing attributes). */
    insertText(el: RichTextHandle, text: string): void {
        invoke(el, 'insertText', { text });
    },

    /** Move/extend the caret. */
    setSelectionRange(el: RichTextHandle, start: number, end: number): void {
        invoke(el, 'setSelectionRange', { start, end });
    },

    /**
     * Insert an atomic mention chip — one U+FFFC char carrying a `mention`
     * span with the chip payload in attrs (the label is never in the text).
     * `replace` removes `[from, to)` first (the trigger query run). Unlike
     * `insertText`, the chip does NOT inherit typing attributes, and typing
     * after it stays plain.
     */
    insertChip(
        el: RichTextHandle,
        chip: { id: string; label: string; kind?: string },
        replace?: { from: number; to: number },
    ): void {
        invoke(el, 'insertChip', {
            id: chip.id,
            label: chip.label,
            ...(chip.kind !== undefined ? { kind: chip.kind } : {}),
            ...(replace ? { replaceFrom: replace.from, replaceTo: replace.to } : {}),
        });
    },

    focus(el: RichTextHandle): void {
        invoke(el, 'focus', {});
    },

    blur(el: RichTextHandle): void {
        invoke(el, 'blur', {});
    },
} as const;
