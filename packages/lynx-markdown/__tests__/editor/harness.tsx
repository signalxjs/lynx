/**
 * Mounts `<MarkdownEditor>` under `@sigx/lynx-testing` and plays the native
 * element: every `<sigx-richtext>` node keeps a `RichDoc` (seeded from its
 * initial `value`, updated by the editor's `setDocument` calls — the handle
 * the surface passes IS the test node — and by the simulated user), and the
 * helpers raise the events the element would raise.
 */
import { vi } from 'vitest';
import { render, waitForUpdate, type TestNode } from '@sigx/lynx-testing';
import { RichTextMethods, decodeDoc, type RichDoc } from '@sigx/lynx-richtext';
import { boundaryKeyFor } from '@sigx/lynx-richtext/web-element';
import { MarkdownEditor, type MarkdownEditorController, type MarkdownEditorProps } from '../../src/editor/MarkdownEditor';

type Handlers = { _handlers: Map<string, (e: unknown) => unknown> };

const docs = new WeakMap<object, RichDoc>();
const carets = new WeakMap<object, { start: number; end: number }>();
const focusedNodes = new Set<object>();

export const spies = {
    setDocument: vi.spyOn(RichTextMethods, 'setDocument'),
    setSelectionRange: vi.spyOn(RichTextMethods, 'setSelectionRange'),
    focus: vi.spyOn(RichTextMethods, 'focus'),
    blur: vi.spyOn(RichTextMethods, 'blur'),
};

/** Install the fake element behaviour on the spies (call in `beforeEach`). */
export function installFakeElement(): void {
    spies.setDocument.mockClear().mockImplementation((el, doc) => {
        if (!el) return;
        const node = el as unknown as TestNode & Handlers;
        const current = docOf(node);
        if (doc.v < current.v) {
            fireChange(node, current);
            return;
        }
        docs.set(node, { ...doc, v: Math.max(doc.v, current.v) });
        const c = carets.get(node);
        if (c) carets.set(node, { start: Math.min(c.start, doc.text.length), end: Math.min(c.end, doc.text.length) });
        fireChange(node, docs.get(node)!);
    });
    spies.setSelectionRange.mockClear().mockImplementation((el, start, end) => {
        if (!el) return;
        const node = el as unknown as TestNode & Handlers;
        carets.set(node, { start, end });
        fireSelection(node, start, end);
    });
    spies.focus.mockClear().mockImplementation((el) => {
        if (!el) return;
        const node = el as unknown as TestNode & Handlers;
        if (focusedNodes.has(node)) return;
        for (const other of focusedNodes) {
            focusedNodes.delete(other);
            (other as Handlers)._handlers.get('bindblur')?.({ type: 'blur', detail: {} });
        }
        focusedNodes.add(node);
        node._handlers.get('bindfocus')?.({ type: 'focus', detail: {} });
    });
    spies.blur.mockClear().mockImplementation((el) => {
        if (!el) return;
        const node = el as unknown as TestNode & Handlers;
        if (!focusedNodes.delete(node)) return;
        node._handlers.get('bindblur')?.({ type: 'blur', detail: {} });
    });
}

export function resetFakeElement(): void {
    for (const spy of Object.values(spies)) spy.mockReset();
    focusedNodes.clear();
}

export function docOf(node: TestNode): RichDoc {
    let d = docs.get(node);
    if (!d) {
        d = decodeDoc(node.props['value'] as string);
        docs.set(node, d);
    }
    return d;
}

export function isFocused(node: TestNode): boolean {
    return focusedNodes.has(node);
}

function fireChange(node: TestNode & Handlers, doc: RichDoc, isComposing = false): void {
    node._handlers.get('bindchange')?.({ type: 'change', detail: { doc: JSON.stringify(doc), isComposing } });
}

function fireSelection(node: TestNode & Handlers, start: number, end: number): void {
    node._handlers.get('bindselection')?.({
        type: 'selection',
        detail: { start, end, activeFormats: '', activeBlock: 'paragraph', caretX: start * 8, caretY: 6, caretHeight: 18 },
    });
}

/** Place the caret as a user tap would (focuses the field first). */
export function tapAt(node: TestNode, start: number, end = start): void {
    const n = node as TestNode & Handlers;
    if (!focusedNodes.has(n)) spies.focus.getMockImplementation()!(n as never);
    carets.set(n, { start, end });
    fireSelection(n, start, end);
}

/** Type text at the field's caret (replacing a selection), as the user would. */
export function typeIn(node: TestNode, text: string): void {
    const n = node as TestNode & Handlers;
    const doc = docOf(n);
    const c = carets.get(n) ?? { start: doc.text.length, end: doc.text.length };
    const delta = text.length - (c.end - c.start);
    const next: RichDoc = {
        text: doc.text.slice(0, c.start) + text + doc.text.slice(c.end),
        spans: doc.spans
            .filter((s) => !(s.start >= c.start && s.end <= c.end && c.end > c.start))
            .map((s) => ({ ...s, start: s.start >= c.end ? s.start + delta : s.start, end: s.end >= c.end ? s.end + delta : s.end })),
        blocks: doc.blocks.map((b, i) => (i === 0 ? { ...b, end: b.end + delta } : b)),
        v: doc.v + 1,
    };
    docs.set(n, next);
    carets.set(n, { start: c.start + text.length, end: c.start + text.length });
    fireChange(n, next);
    fireSelection(n, c.start + text.length, c.start + text.length);
}

/** Press a key: a boundary key per the element's table is reported, an in-block delete is performed. */
export function press(node: TestNode, key: string): void {
    const n = node as TestNode & Handlers;
    const doc = docOf(n);
    const c = carets.get(n) ?? { start: doc.text.length, end: doc.text.length };
    const [base, shift] = key.startsWith('Shift-') ? [key.slice(6), true] : [key, false];
    const name = boundaryKeyFor({ key: base, shiftKey: shift }, c, doc.text.length, () => true);
    if (name) {
        n._handlers.get('bindboundarykey')?.({ type: 'boundarykey', detail: { key: name, start: c.start, end: c.end } });
        return;
    }
    if (base === 'Backspace' && c.start === c.end && c.start > 0) {
        carets.set(n, { start: c.start - 1, end: c.start });
        typeIn(n, '');
    }
}

/** Fire the wrapper's layout event so the popup has a frame to place against. */
export function layoutFields(container: TestNode): void {
    for (const v of container.findAllByType('view')) {
        const h = (v as TestNode & Handlers)._handlers.get('bindlayoutchange');
        if (h) h({ type: 'layoutchange', detail: { width: 320, height: 48, top: 400, left: 0, right: 320, bottom: 448 } });
    }
}

export interface Mounted {
    container: TestNode;
    controller: MarkdownEditorController;
    fields(): TestNode[];
    field(i: number): TestNode;
    unmount(): void;
}

export async function mountEditor(props: Partial<MarkdownEditorProps> & Record<string, unknown> = {}): Promise<Mounted> {
    let controller!: MarkdownEditorController;
    const { container, unmount } = render(
        <MarkdownEditor
            {...(props as MarkdownEditorProps)}
            controllerRef={(c) => {
                controller = c;
                (props.controllerRef as ((c: MarkdownEditorController) => void) | undefined)?.(c);
            }}
        />,
    );
    await waitForUpdate();
    return {
        container,
        controller,
        fields: () => container.findAllByType('sigx-richtext'),
        field: (i) => container.findAllByType('sigx-richtext')[i],
        unmount,
    };
}
