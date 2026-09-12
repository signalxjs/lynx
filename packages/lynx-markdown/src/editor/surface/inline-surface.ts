/**
 * `createLynxInlineSurface()` — the `InlineSurface` of the block editor core
 * over one `<sigx-richtext boundary-keys>` element.
 *
 * The element is the source of truth for live text: every `bindchange` is
 * read back into the flat model and reported whole (the core's bridge diffs
 * it). Commands go through `RichTextMethods` (fire-and-forget); the state
 * reconciles on the next event. Boundary keys arrive through
 * `bindboundarykey` and become `boundary` events; a native build that
 * predates the event still works in degraded form — a `\n` that reaches a
 * change is stripped and reported as `Enter` at that offset, and the edge
 * deletes simply stay in-block.
 *
 * IME: the element flags `isComposing` on every change; the first composing
 * change opens a composition (`compositionStart`), the first non-composing
 * change after it closes it (`compositionEnd` with the committed content).
 *
 * The view mounts the element and feeds the surface through `native.*`;
 * tests feed it from a fake element.
 */

import type { InlineFlat } from '@sigx/markdown/editor';
import { flatEquals } from '@sigx/markdown/editor';
import type { BoundaryKey, CaretRect, InlineSurface, InlineSurfaceInit, Range } from '@sigx/markdown/editor';
import type { RichDoc, RichTextBoundaryKeyEvent, RichTextHandle, SelectionState } from '@sigx/lynx-richtext';
import { RichTextMethods } from '@sigx/lynx-richtext';
import { blockAttrFor, docToFlat, flatToDoc } from './rich-doc.js';

/** The commands a surface sends; `RichTextMethods` by default, a fake in tests. */
export type RichTextCommands = Pick<typeof RichTextMethods, 'setDocument' | 'setSelectionRange' | 'focus' | 'blur'>;

export interface LynxInlineSurfaceOptions {
    /** The element handle (delivered by `onElement`; may be null before mount). */
    handle: () => RichTextHandle;
    commands?: RichTextCommands;
    /** Whether the element reports boundary keys (a build with #1116). Default true; the degraded path covers false. */
    boundaryKeys?: boolean;
    /** The view flips the element's `editable` prop here (`setReadOnly`). */
    onReadOnly?(readOnly: boolean): void;
}

/** What the view feeds from the element's events. */
export interface LynxInlineSurfaceNative {
    /** The element handle is available (`onElement`): a focus asked for before mount is applied now. */
    attached(): void;
    change(doc: RichDoc, isComposing: boolean): void;
    selection(sel: SelectionState): void;
    boundaryKey(e: RichTextBoundaryKeyEvent['detail']): void;
    focus(): void;
    blur(): void;
}

export interface LynxInlineSurface extends InlineSurface {
    readonly key: string;
    readonly native: LynxInlineSurfaceNative;
    /** The `RichDoc` to mount the element with (the initial `value`). */
    readonly initialDoc: RichDoc;
    /** The last `RichDoc` known to be in the element (for tests and debugging). */
    readonly doc: RichDoc;
    /** The last selection the element reported. */
    readonly selectionState: SelectionState | null;
    readonly focused: boolean;
}

/** Where the caret lands after a single-region edit from `prev` to `next` (null when the texts are equal). */
function caretAfterEdit(prev: string, next: string): number | null {
    if (prev === next) return null;
    let start = 0;
    while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
    let endPrev = prev.length;
    let endNext = next.length;
    while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
        endPrev--;
        endNext--;
    }
    return endNext;
}

export function createLynxInlineSurface(init: InlineSurfaceInit, opts: LynxInlineSurfaceOptions): LynxInlineSurface {
    const { events } = init;
    const commands = opts.commands ?? RichTextMethods;
    let blockAttr = blockAttrFor(init.blockType, init.attrs);
    let version = 0;
    /** The content the element holds, as last written to or read from it. */
    let doc: RichDoc = flatToDoc(init.flat, blockAttr, version);
    let known: InlineFlat = init.flat;
    let composing = false;
    let readOnly = init.readOnly;
    let focused = false;
    let selection: SelectionState | null = null;
    /** A selection asked for before the element reported one; applied on focus. */
    let wantedRange: Range | null = null;
    /** A focus asked for before the element handle existed (a block mounted by this very transaction). */
    let pendingFocus = false;

    const range = (): Range | null => (selection ? { start: Math.min(selection.start, selection.end), end: Math.max(selection.start, selection.end) } : null);
    const length = (): number => doc.text.length;

    const push = (flat: InlineFlat): void => {
        version = Math.max(version, doc.v) + 1;
        doc = flatToDoc(flat, blockAttr, version);
        known = flat;
        commands.setDocument(opts.handle(), doc);
    };

    const native: LynxInlineSurfaceNative = {
        attached() {
            if (!pendingFocus) return;
            pendingFocus = false;
            commands.focus(opts.handle());
            if (wantedRange) commands.setSelectionRange(opts.handle(), wantedRange.start, wantedRange.end);
        },
        change(next, isComposing) {
            doc = next;
            version = Math.max(version, next.v);
            let flat = docToFlat(next);
            if (isComposing && !composing) {
                composing = true;
                events.compositionStart();
            }
            // Degraded Enter: a build without boundary keys inserts the newline; split there.
            const nl = opts.boundaryKeys === false ? flat.text.indexOf('\n') : -1;
            if (nl >= 0 && !isComposing) {
                const before = flat.text.slice(0, nl) + flat.text.slice(nl + 1);
                flat = {
                    text: before,
                    spans: flat.spans.filter((s) => s.start !== nl || s.end !== nl + 1).map((s) => ({ ...s, start: s.start > nl ? s.start - 1 : s.start, end: s.end > nl ? s.end - 1 : s.end })),
                };
                push(flat);
                events.boundary({ key: 'Enter', range: { start: nl, end: nl } });
                return;
            }
            if (!isComposing && composing) {
                composing = false;
                known = flat;
                events.compositionEnd(flat);
                return;
            }
            if (!isComposing && flatEquals(flat, known)) return;
            // The element's selection event may land before or after its change
            // event depending on the platform; for a typing edit the caret is
            // at the end of the inserted text, so report that until told otherwise.
            const guess = caretAfterEdit(known.text, flat.text);
            if (guess !== null) selection = selection ? { ...selection, start: guess, end: guess } : { start: guess, end: guess, activeFormats: [], activeBlock: blockAttr.type, caretRect: { x: 0, y: 0, height: 0 } };
            known = flat;
            events.change({ flat, selection: range(), composing: isComposing });
        },
        selection(sel) {
            selection = sel;
            const r = range()!;
            events.selection({ range: r, caret: sel.caretRect });
        },
        boundaryKey(e) {
            if (readOnly) return;
            const r: Range = { start: Math.min(e.start, e.end), end: Math.max(e.start, e.end) };
            selection = selection ? { ...selection, start: r.start, end: r.end } : { start: r.start, end: r.end, activeFormats: [], activeBlock: blockAttr.type, caretRect: { x: 0, y: 0, height: 0 } };
            events.boundary({ key: e.key as BoundaryKey, range: r });
        },
        focus() {
            focused = true;
            if (wantedRange) {
                const w = wantedRange;
                wantedRange = null;
                surface.setSelection(w);
            }
            events.focus();
        },
        blur() {
            focused = false;
            events.blur();
        },
    };

    const surface: LynxInlineSurface = {
        key: init.key,
        native,
        get initialDoc() {
            return flatToDoc(init.flat, blockAttrFor(init.blockType, init.attrs), 0);
        },
        get doc() {
            return doc;
        },
        get selectionState() {
            return selection;
        },
        get focused() {
            return focused;
        },
        setInline(flat) {
            if (flatEquals(flat, known)) return;
            push(flat);
        },
        setAttrs(blockType, attrs) {
            const next = blockAttrFor(blockType, attrs);
            if (next.type === blockAttr.type && next.level === blockAttr.level) return;
            blockAttr = next;
            push(known);
        },
        setSelection(r) {
            const len = length();
            const start = Math.max(0, Math.min(r.start, len));
            const end = Math.max(0, Math.min(r.end, len));
            selection = selection ? { ...selection, start, end } : { start, end, activeFormats: [], activeBlock: blockAttr.type, caretRect: { x: 0, y: 0, height: 0 } };
            // Before the handle exists the range rides along with the deferred focus.
            if (opts.handle()) commands.setSelectionRange(opts.handle(), start, end);
            else wantedRange = { start, end };
        },
        focus(target) {
            const len = length();
            let offset: number;
            if (!target) offset = range()?.start ?? len;
            else if ('edge' in target) offset = target.edge === 'start' ? 0 : len;
            else if ('offset' in target) offset = target.offset;
            else offset = surface.offsetAtX(target.line, target.x);
            const r = { start: offset, end: offset };
            if (!focused) {
                wantedRange = r;
                if (opts.handle()) commands.focus(opts.handle());
                else pendingFocus = true;
            }
            surface.setSelection(r);
        },
        blur() {
            if (focused) commands.blur(opts.handle());
        },
        getFlat: () => known,
        getSelection: () => range(),
        caretRect(): CaretRect | null {
            return selection ? selection.caretRect : null;
        },
        offsetAtX(line) {
            // The element reports no per-x hit testing; land at the line's edge.
            return line === 'first' ? 0 : length();
        },
        isComposing: () => composing,
        setReadOnly(next) {
            if (next === readOnly) return;
            readOnly = next;
            opts.onReadOnly?.(next);
        },
        destroy() {
            /* the element goes with its component */
        },
    };
    return surface;
}
