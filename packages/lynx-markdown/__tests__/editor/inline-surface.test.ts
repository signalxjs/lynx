import { describe, expect, it } from 'vitest';
import { runInlineSurfaceConformance, type SurfaceDriver } from '@sigx/richtext/testing';
import { ATOM_CHAR, flatEquals, standardSchema } from '@sigx/richtext/editor';
import type { InlineFlat, InlineSurfaceEvents, InlineSurfaceInit } from '@sigx/richtext/editor';
import { createLynxInlineSurface, type LynxInlineSurface } from '../../src/editor/surface/inline-surface';
import { blockAttrFor, docToFlat, flatToDoc } from '../../src/editor/surface/rich-doc';
import { createFakeRichText, type FakeRichText } from './fake-richtext';

const handle = { id: 1 };

function create(init: InlineSurfaceInit): { surface: LynxInlineSurface; fake: FakeRichText } {
    const fake = createFakeRichText();
    const surface = createLynxInlineSurface(init, {
        handle: () => handle,
        commands: fake.commands,
        onReadOnly: (ro) => {
            fake.editable = !ro;
        },
    });
    fake.attach(surface);
    return { surface, fake };
}

const fakes = new WeakMap<LynxInlineSurface, FakeRichText>();

const driver: SurfaceDriver = {
    type: (s, text) => fakes.get(s as LynxInlineSurface)!.type(text),
    press: (s, key) => fakes.get(s as LynxInlineSurface)!.press(key),
    setCaret: (s, offset) => s.setSelection({ start: offset, end: offset }),
    compose: (s, updates, committed) => {
        fakes.get(s as LynxInlineSurface)!.compose(updates, committed);
        return true;
    },
};

describe('LynxInlineSurface conformance', () => {
    runInlineSurfaceConformance({
        create: (init) => {
            const { surface, fake } = create(init);
            fakes.set(surface, fake);
            return surface;
        },
        driver,
        it,
        expect,
    });
});

function events(log: string[]): InlineSurfaceEvents {
    return {
        change: (e) => {
            log.push(`change:${e.flat.text}:${e.composing}`);
        },
        selection: (e) => {
            log.push(`sel:${e.range.start}-${e.range.end}`);
        },
        boundary: (e) => {
            log.push(`boundary:${e.key}@${e.range.start}`);
            return true;
        },
        paste: () => true,
        focus: () => {
            log.push('focus');
        },
        blur: () => {
            log.push('blur');
        },
        compositionStart: () => {
            log.push('cstart');
        },
        compositionEnd: (f) => {
            log.push(`cend:${f.text}`);
        },
    };
}

const init = (flat: InlineFlat, log: string[], blockType = 'paragraph', attrs: Record<string, unknown> = {}): InlineSurfaceInit => ({
    key: 'b-0',
    blockType,
    schema: standardSchema,
    attrs,
    flat,
    readOnly: false,
    events: events(log),
});

describe('flat ↔ RichDoc', () => {
    it('maps marks, links and atoms both ways without loss', () => {
        const flat: InlineFlat = {
            text: `a b c ${ATOM_CHAR} d ${ATOM_CHAR}`,
            spans: [
                { start: 0, end: 1, type: 'strong' },
                { start: 2, end: 3, type: 'emphasis' },
                { start: 4, end: 5, type: 'delete' },
                { start: 0, end: 5, type: 'inlineCode' },
                { start: 8, end: 9, type: 'link', attrs: { url: 'https://x', title: 'T' } },
                { start: 6, end: 7, type: 'mention', attrs: { id: 'u1', label: 'Andy' } },
                { start: 10, end: 11, type: 'image', attrs: { url: 'i.png', alt: 'pic' } },
            ],
        };
        const doc = flatToDoc(flat, { type: 'paragraph' }, 3);
        expect(doc.v).toBe(3);
        expect(doc.blocks).toEqual([{ start: 0, end: flat.text.length, type: 'paragraph' }]);
        expect(doc.spans.map((s) => s.type)).toEqual(['bold', 'italic', 'strike', 'code', 'link', 'mention', 'mention']);
        expect(doc.spans[4].attrs).toEqual({ href: 'https://x', title: 'T' });
        expect(doc.spans[5].attrs).toEqual({ id: 'u1', label: 'Andy', atom: 'mention' });
        expect(doc.spans[6].attrs).toEqual({ url: 'i.png', alt: 'pic', atom: 'image', label: 'pic', id: 'i.png' });
        expect(flatEquals(docToFlat(doc), flat)).toBe(true);
    });

    it('splits hard breaks into consecutive blocks of the block type', () => {
        const doc = flatToDoc({ text: 'a\nbc', spans: [] }, blockAttrFor('heading', { depth: 2 }), 0);
        expect(doc.blocks).toEqual([
            { start: 0, end: 1, type: 'heading', level: 2 },
            { start: 2, end: 4, type: 'heading', level: 2 },
        ]);
        expect(docToFlat(doc).text).toBe('a\nbc');
        expect(blockAttrFor('heading', { depth: 9 })).toEqual({ type: 'heading', level: 6 });
        expect(blockAttrFor('tableCell', {})).toEqual({ type: 'paragraph' });
    });

    it('clips a malformed chip span to one unit and drops unknown span types', () => {
        const flat = docToFlat({ text: 'ab', spans: [{ start: 0, end: 2, type: 'mention', attrs: { id: '1', label: 'x' } }, { start: 0, end: 1, type: 'weird' as never }], blocks: [], v: 0 });
        expect(flat.spans).toEqual([{ start: 0, end: 1, type: 'mention', attrs: { id: '1', label: 'x' } }]);
    });
});

describe('LynxInlineSurface', () => {
    it('mounts with the block rendered as its RichDoc and pushes new content with a bumped version', () => {
        const log: string[] = [];
        const { surface, fake } = create(init({ text: 'hi', spans: [{ start: 0, end: 2, type: 'strong' }] }, log, 'heading', { depth: 2 }));
        expect(surface.initialDoc.blocks[0]).toEqual({ start: 0, end: 2, type: 'heading', level: 2 });
        expect(surface.initialDoc.spans).toEqual([{ start: 0, end: 2, type: 'bold' }]);
        surface.setInline({ text: 'hey', spans: [] });
        expect(fake.doc.text).toBe('hey');
        expect(fake.doc.v).toBe(1);
        expect(fake.doc.blocks[0].type).toBe('heading');
        // The element's echo of our own write is not a change.
        expect(log.filter((l) => l.startsWith('change'))).toEqual([]);
        surface.setAttrs('paragraph', {});
        expect(fake.doc.blocks[0].type).toBe('paragraph');
        expect(fake.doc.v).toBe(2);
    });

    it('reports boundary keys with the pressed selection and none while read-only', () => {
        const log: string[] = [];
        const { surface, fake } = create(init({ text: 'ab', spans: [] }, log));
        surface.focus({ offset: 0 });
        fake.press('Backspace');
        fake.press('Tab');
        expect(log.filter((l) => l.startsWith('boundary'))).toEqual(['boundary:Backspace@0', 'boundary:Tab@0']);
        surface.setReadOnly(true);
        fake.press('Enter');
        expect(log.filter((l) => l.startsWith('boundary'))).toHaveLength(2);
    });

    it('degrades on a build without boundary keys: a typed newline becomes Enter at its offset', () => {
        const log: string[] = [];
        const { surface, fake } = create(init({ text: 'ab', spans: [{ start: 0, end: 2, type: 'strong' }] }, log));
        surface.focus({ offset: 1 });
        fake.type('\n');
        expect(log.filter((l) => l.startsWith('boundary'))).toEqual(['boundary:Enter@1']);
        expect(fake.doc.text).toBe('ab');
        expect(surface.getFlat()).toEqual({ text: 'ab', spans: [{ start: 0, end: 2, type: 'strong' }] });
    });

    it('leaves a hard break the core wrote alone, but splits at a newline typed after it', () => {
        const log: string[] = [];
        const { surface, fake } = create(init({ text: 'a', spans: [] }, log));
        // The core inserts a hard break (Shift-Enter): a `\n` in the flat is legitimate.
        surface.setInline({ text: 'a\nb', spans: [] });
        expect(fake.doc.text).toBe('a\nb');
        surface.focus({ offset: 3 });
        fake.type('c');
        expect(log.filter((l) => l.startsWith('boundary'))).toEqual([]);
        expect(surface.getFlat().text).toBe('a\nbc');
        // A newline the user inserted (older native build) still splits — at its own offset.
        fake.type('\n');
        expect(log.filter((l) => l.startsWith('boundary'))).toEqual(['boundary:Enter@4']);
        expect(fake.doc.text).toBe('a\nbc');
    });

    it('opens and closes a composition from the isComposing flag', () => {
        const log: string[] = [];
        const { surface, fake } = create(init({ text: 'a', spans: [] }, log));
        surface.focus({ offset: 1 });
        fake.compose(['k', 'ka'], 'か');
        expect(log.filter((l) => l === 'cstart')).toHaveLength(1);
        expect(log.filter((l) => l.startsWith('cend'))).toEqual(['cend:aか']);
        expect(log.filter((l) => l.startsWith('change')).every((l) => l.endsWith(':true'))).toBe(true);
    });

    it('applies a selection asked for before focus once the element focuses', () => {
        const log: string[] = [];
        const { surface, fake } = create(init({ text: 'hello', spans: [] }, log));
        surface.focus({ edge: 'end' });
        expect(fake.focused).toBe(true);
        expect(surface.getSelection()).toEqual({ start: 5, end: 5 });
        expect(log).toContain('focus');
        expect(fake.calls.filter((c) => c.startsWith('setSelectionRange'))).toContain('setSelectionRange:5-5');
        surface.blur();
        expect(log).toContain('blur');
        expect(surface.caretRect()).toEqual({ x: 40, y: 0, height: 20 });
        expect(surface.offsetAtX('last', 999)).toBe(5);
    });
});

describe('LynxInlineSurface before the element handle exists', () => {
    it('defers a focus asked for before mount until the handle is attached', () => {
        const log: string[] = [];
        const fake = createFakeRichText();
        let mounted: { id: number } | null = null;
        const surface = createLynxInlineSurface(init({ text: 'ab', spans: [] }, log), { handle: () => mounted, commands: fake.commands });
        fake.attach(surface);
        // A block mounted by the same transaction gets the caret before its element reports a handle.
        surface.focus({ edge: 'end' });
        expect(fake.calls).toEqual([]);
        mounted = { id: 7 };
        surface.native.attached();
        expect(fake.calls).toEqual(['focus', 'setSelectionRange:2-2']);
        expect(fake.focused).toBe(true);
        // Attaching again is a no-op.
        surface.native.attached();
        expect(fake.calls).toHaveLength(2);
    });
});
