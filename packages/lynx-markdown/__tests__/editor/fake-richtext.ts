/**
 * An in-memory `<sigx-richtext boundary-keys>`: holds a `RichDoc` and a
 * selection like the native element, answers the commands the surface sends
 * (`setDocument` with the version rules, `setSelectionRange`, `focus`,
 * `blur`) and lets a test act as the user — type, delete, press boundary
 * keys, compose — raising the events native would raise.
 */

import type { RichDoc, SelectionState } from '@sigx/lynx-richtext';
import { docEquals, normalizeDoc } from '@sigx/lynx-richtext';
import { boundaryKeyFor } from '@sigx/lynx-richtext/web-element';
import type { LynxInlineSurface, RichTextCommands } from '../../src/editor/surface/inline-surface';

export interface FakeRichText {
    commands: RichTextCommands;
    doc: RichDoc;
    start: number;
    end: number;
    focused: boolean;
    composing: boolean;
    editable: boolean;
    /** Bind the surface whose `native` feeders receive the events. */
    attach(surface: LynxInlineSurface): void;
    /** Simulate the user typing `text` at the selection (replacing it). */
    type(text: string): void;
    /** Simulate a boundary key press at the current selection. */
    press(key: string): void;
    /** Simulate a caret placement by the user. */
    select(start: number, end?: number): void;
    /** Simulate an IME session: provisional updates, then the committed text. */
    compose(updates: string[], committed: string): void;
    calls: string[];
}

export function createFakeRichText(): FakeRichText {
    let surface: LynxInlineSurface | null = null;
    const fake: FakeRichText = {
        doc: { text: '', spans: [], blocks: [{ start: 0, end: 0, type: 'paragraph' }], v: 0 },
        start: 0,
        end: 0,
        focused: false,
        composing: false,
        editable: true,
        calls: [],
        commands: {
            setDocument(_el, doc) {
                fake.calls.push(`setDocument:${doc.text}`);
                if (fake.composing) {
                    surface?.native.change(fake.doc, true);
                    return;
                }
                if (doc.v < fake.doc.v) {
                    surface?.native.change(fake.doc, false);
                    return;
                }
                if (docEquals(normalizeDoc(doc), normalizeDoc(fake.doc))) return;
                fake.doc = { ...doc, v: Math.max(doc.v, fake.doc.v) };
                fake.start = Math.min(fake.start, doc.text.length);
                fake.end = Math.min(fake.end, doc.text.length);
                surface?.native.change(fake.doc, false);
            },
            setSelectionRange(_el, start, end) {
                fake.calls.push(`setSelectionRange:${start}-${end}`);
                fake.start = start;
                fake.end = end;
                selection();
            },
            focus() {
                fake.calls.push('focus');
                if (fake.focused) return;
                fake.focused = true;
                surface?.native.focus();
                selection();
            },
            blur() {
                fake.calls.push('blur');
                if (!fake.focused) return;
                fake.focused = false;
                surface?.native.blur();
            },
        },
        attach(s) {
            surface = s;
            fake.doc = s.initialDoc;
        },
        type(text) {
            if (!fake.focused || !fake.editable) return;
            edit(text);
            surface?.native.change(fake.doc, false);
            selection();
        },
        press(key) {
            if (!fake.editable) return;
            // The platform table decides whether this press crosses the edge; otherwise the element acts on it.
            const [base, shift] = key.startsWith('Shift-') ? [key.slice(6), true] : [key, false];
            const name = boundaryKeyFor({ key: base, shiftKey: shift }, { start: fake.start, end: fake.end }, fake.doc.text.length, () => true);
            if (name) {
                surface?.native.boundaryKey({ key: name as never, start: fake.start, end: fake.end });
                return;
            }
            if (base === 'Backspace' && fake.start === fake.end && fake.start > 0) {
                fake.start -= 1;
                edit('');
                surface?.native.change(fake.doc, false);
                selection();
            } else if (base === 'Delete' && fake.start === fake.end && fake.end < fake.doc.text.length) {
                fake.end += 1;
                edit('');
                surface?.native.change(fake.doc, false);
                selection();
            }
        },
        select(start, end = start) {
            fake.start = start;
            fake.end = end;
            selection();
        },
        compose(updates, committed) {
            const anchor = fake.start;
            fake.composing = true;
            let shown = '';
            for (const u of updates) {
                fake.start = anchor;
                fake.end = anchor + shown.length;
                edit(u);
                shown = u;
                surface?.native.change(fake.doc, true);
            }
            fake.start = anchor;
            fake.end = anchor + shown.length;
            edit(committed);
            fake.composing = false;
            surface?.native.change(fake.doc, false);
        },
    };

    const edit = (text: string): void => {
        const { start, end } = fake;
        const before = fake.doc.text.slice(0, start);
        const after = fake.doc.text.slice(end);
        const delta = text.length - (end - start);
        const spans = fake.doc.spans
            .filter((s) => !(s.start >= start && s.end <= end && s.end - s.start > 0 && end > start && s.start >= start && s.end <= end))
            .map((s) => ({ ...s, start: s.start >= end ? s.start + delta : s.start, end: s.end >= end ? s.end + delta : s.end > start ? Math.max(start, s.end) : s.end }));
        const textOut = before + text + after;
        fake.doc = { text: textOut, spans, blocks: [{ ...fake.doc.blocks[0], start: 0, end: textOut.length }], v: fake.doc.v + 1 };
        fake.start = fake.end = start + text.length;
    };

    const selection = (): void => {
        const sel: SelectionState = { start: fake.start, end: fake.end, activeFormats: [], activeBlock: 'paragraph', caretRect: { x: fake.start * 8, y: 0, height: 20 } };
        surface?.native.selection(sel);
    };

    return fake;
}
