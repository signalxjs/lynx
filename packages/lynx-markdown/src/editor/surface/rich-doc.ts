/**
 * The flat model ↔ `RichDoc` mapping for ONE block.
 *
 * The block editor core speaks `InlineFlat` (marks as ranges, atoms as one
 * U+FFFC, hard breaks as `\n`); `<sigx-richtext>` speaks `RichDoc` (the same
 * flat text, spans typed `bold` / `italic` / `strike` / `code` / `link` /
 * `mention`, blocks aligned to `\n`). The mapping is lossless:
 *
 *  - marks: `strong ↔ bold`, `emphasis ↔ italic`, `delete ↔ strike`,
 *    `inlineCode ↔ code`, `link ↔ link` (`url` ↔ `href`, other attrs kept);
 *  - atoms: every atom becomes a `mention` span (the element's one chip type)
 *    carrying `attrs.atom = <atom type>` plus the atom's attrs — a mention
 *    keeps `id` / `label` / `kind`, an image keeps `url` / `alt` with
 *    `label = alt` (`kind` stays the app's field, as `insertChip` defines it);
 *  - blocks: one block attr per `\n`-separated line, all of the block's own
 *    type (`heading` with its level, else `paragraph`).
 *
 * Offsets are UTF-16 code units on both sides, so nothing shifts.
 */

import type { InlineFlat, InlineSpan as FlatSpan } from '@sigx/markdown/editor';
import { ATOM_CHAR } from '@sigx/markdown/editor';
import type { BlockAttr, BlockAttrType, InlineSpan, InlineSpanType, RichDoc } from '@sigx/lynx-richtext';

const MARK_TO_SPAN: Record<string, InlineSpanType> = {
    strong: 'bold',
    emphasis: 'italic',
    delete: 'strike',
    inlineCode: 'code',
    link: 'link',
};

const SPAN_TO_MARK: Record<string, string> = {
    bold: 'strong',
    italic: 'emphasis',
    strike: 'delete',
    code: 'inlineCode',
    link: 'link',
};

function isAtom(flat: InlineFlat, s: FlatSpan): boolean {
    return s.end - s.start === 1 && flat.text[s.start] === ATOM_CHAR && !(s.type in MARK_TO_SPAN);
}

/** The block attr the element renders a block type with. */
export function blockAttrFor(blockType: string, attrs: Record<string, unknown>): { type: BlockAttrType; level?: number } {
    if (blockType === 'heading') {
        const depth = Number(attrs.depth);
        return { type: 'heading', level: Number.isFinite(depth) ? Math.min(6, Math.max(1, Math.floor(depth))) : 1 };
    }
    return { type: 'paragraph' };
}

/** A block editor flat model as a single-block `RichDoc` at version `v`. */
export function flatToDoc(flat: InlineFlat, block: { type: BlockAttrType; level?: number }, v: number): RichDoc {
    const spans: InlineSpan[] = [];
    for (const s of flat.spans) {
        if (isAtom(flat, s)) {
            const attrs: Record<string, string> = { ...s.attrs, atom: s.type };
            if (attrs.label === undefined) attrs.label = attrs.alt ?? attrs.title ?? s.type;
            if (attrs.id === undefined) attrs.id = attrs.url ?? '';
            spans.push({ start: s.start, end: s.end, type: 'mention', attrs });
            continue;
        }
        const type = MARK_TO_SPAN[s.type];
        if (!type) continue; // a plugin mark the element cannot show: dropped visually, kept by the core
        if (type === 'link') {
            const { url, ...rest } = s.attrs ?? {};
            spans.push({ start: s.start, end: s.end, type, attrs: { ...rest, href: url ?? '' } });
        } else {
            spans.push({ start: s.start, end: s.end, type });
        }
    }
    const blocks: BlockAttr[] = [];
    let at = 0;
    for (const line of flat.text.split('\n')) {
        const attr: BlockAttr = { start: at, end: at + line.length, type: block.type };
        if (block.level !== undefined) attr.level = block.level;
        blocks.push(attr);
        at += line.length + 1;
    }
    return { text: flat.text, spans, blocks, v };
}

/** The flat model an element `RichDoc` reads back to (the block attrs are the block's own, ignored here). */
export function docToFlat(doc: RichDoc): InlineFlat {
    const spans: FlatSpan[] = [];
    for (const s of doc.spans) {
        if (s.type === 'mention') {
            const { atom, ...rest } = s.attrs ?? {};
            const type = atom && atom !== '' ? atom : 'mention';
            const attrs: Record<string, string> = { ...rest };
            if (type === 'image') {
                // The chip carried the image's fields under mention names as well; strip those.
                delete attrs.id;
                delete attrs.label;
            }
            // A chip is exactly one U+FFFC; a malformed span over more text is clipped to one unit.
            spans.push({ start: s.start, end: s.start + 1, type, attrs });
            continue;
        }
        const type = SPAN_TO_MARK[s.type];
        if (!type) continue;
        if (type === 'link') {
            const { href, ...rest } = s.attrs ?? {};
            spans.push({ start: s.start, end: s.end, type, attrs: { ...rest, url: href ?? '' } });
        } else {
            spans.push({ start: s.start, end: s.end, type });
        }
    }
    return { text: doc.text, spans };
}
