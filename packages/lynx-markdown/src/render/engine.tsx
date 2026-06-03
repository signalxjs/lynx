/**
 * Render engine: walks a `BlockNode[]` AST and dispatches each node to a
 * {@link MarkdownComponents} renderer.
 *
 * Responsibilities the engine keeps (so components stay simple and design
 * systems can't accidentally break streaming):
 *  - AST recursion — children are fully rendered before a component is called.
 *  - Stable reconciliation keys — `VNode.key` is stamped from the AST node's
 *    streaming key after the component returns, so finalized blocks never
 *    remount regardless of which element a component produced.
 */

import type { JSXElement, VNode } from '@sigx/lynx';
import type { BlockNode, InlineNode } from '../ast.js';
import type { MarkdownChild, MarkdownComponents } from './components.js';

export interface RenderContext {
    components: MarkdownComponents;
    onLink?: (href: string) => void;
    onImageTap?: (src: string) => void;
}

/** Stamp a stable reconciliation key onto a rendered element (no-op for strings). */
function stampKey(el: MarkdownChild | JSXElement, key: string): void {
    if (el && typeof el === 'object') (el as VNode).key = key;
}

/** Render top-level blocks and wrap them in the `root` container. */
export function renderDocument(blocks: BlockNode[], ctx: RenderContext): JSXElement {
    const children = blocks.map((b) => renderBlock(b, ctx));
    return ctx.components.root({ children });
}

function renderBlock(block: BlockNode, ctx: RenderContext): JSXElement {
    const C = ctx.components;
    let el: JSXElement;
    switch (block.type) {
        case 'heading':
            el = C.heading({ level: block.level, children: renderInline(block.children, ctx), node: block });
            break;
        case 'paragraph':
            el = C.paragraph({ children: renderInline(block.children, ctx), node: block });
            break;
        case 'blockquote':
            el = C.blockquote({ children: block.children.map((b) => renderBlock(b, ctx)), node: block });
            break;
        case 'list':
            el = C.list({
                ordered: block.ordered,
                start: block.start,
                tight: block.tight,
                children: block.items.map((item, i) => {
                    const li = C.listItem({
                        ordered: block.ordered,
                        index: i,
                        number: block.start + i,
                        checked: item.checked,
                        children: item.children.map((b) => renderBlock(b, ctx)),
                        item,
                    });
                    stampKey(li, item.key);
                    return li;
                }),
                node: block,
            });
            break;
        case 'codeBlock':
            el = C.code({
                ...(block.lang ? { lang: block.lang } : {}),
                value: block.value,
                closed: block.closed,
                node: block,
            });
            break;
        case 'thematicBreak':
            el = C.thematicBreak({ node: block });
            break;
        case 'table':
            el = renderTable(block, ctx);
            break;
    }
    stampKey(el, block.key);
    return el;
}

function renderTable(
    block: Extract<BlockNode, { type: 'table' }>,
    ctx: RenderContext,
): JSXElement {
    const C = ctx.components;
    const headerCells = block.header.map((cell, i) => {
        const c = C.tableCell({
            header: true,
            align: block.align[i] ?? null,
            children: renderInline(cell.children, ctx),
            node: block,
        });
        stampKey(c, `c${i}`);
        return c;
    });
    const headerRow = C.tableRow({ header: true, children: headerCells, node: block });
    stampKey(headerRow, 'head');

    const bodyRows = block.rows.map((row, ri) => {
        const cells = row.map((cell, ci) => {
            const c = C.tableCell({
                header: false,
                align: block.align[ci] ?? null,
                children: renderInline(cell.children, ctx),
                node: block,
            });
            stampKey(c, `c${ci}`);
            return c;
        });
        const r = C.tableRow({ header: false, children: cells, node: block });
        stampKey(r, `r${ri}`);
        return r;
    });

    return C.table({ align: block.align, children: [headerRow, ...bodyRows], node: block });
}

function renderInline(nodes: InlineNode[], ctx: RenderContext): MarkdownChild[] {
    return nodes.map((node, i) => {
        const el = renderInlineNode(node, ctx);
        stampKey(el, String(i));
        return el;
    });
}

function renderInlineNode(node: InlineNode, ctx: RenderContext): MarkdownChild {
    const C = ctx.components;
    switch (node.type) {
        case 'text':
            return node.value;
        case 'br':
            return C.br();
        case 'strong':
            return C.strong({ children: renderInline(node.children, ctx), node });
        case 'em':
            return C.em({ children: renderInline(node.children, ctx), node });
        case 'del':
            return C.del({ children: renderInline(node.children, ctx), node });
        case 'codeSpan':
            return C.codeSpan({ value: node.value, node });
        case 'link':
            return C.link({
                href: node.href,
                ...(node.title ? { title: node.title } : {}),
                children: renderInline(node.children, ctx),
                onLink: ctx.onLink,
                node,
            });
        case 'autolink':
            return C.autolink({ href: node.href, value: node.value, onLink: ctx.onLink, node });
        case 'image':
            return C.image({
                src: node.src,
                alt: node.alt,
                ...(node.title ? { title: node.title } : {}),
                onImageTap: ctx.onImageTap,
                node,
            });
    }
}
