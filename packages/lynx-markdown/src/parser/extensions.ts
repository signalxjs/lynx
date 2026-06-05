/**
 * Parser inline-extension contract: a plugin recognizes its own inline
 * construct (a mention, an emoji shortcode, …) and produces an
 * `InlineExtension` AST node, without touching this package.
 *
 * Extensions run inside the tokenizer at the same precedence tier as code
 * spans and links: a successful match emits one opaque token the emphasis
 * stack never looks into. Matching is gated by `triggerChars`, so the cost
 * when no extension is in play is zero, and one set lookup per char otherwise.
 */

import type { InlineExtension } from '../ast.js';

export interface ParserInlineExtension {
    /** Stable extension name; also the render dispatch key (`components.extension[name]`). */
    name: string;
    /**
     * Fast-path gate: the character(s) that can begin this construct. `match`
     * is only called when the current character is in this set. Must be
     * non-empty — an ungated extension would have to be probed at every
     * position, which is banned for parse cost and memoization reasons.
     */
    triggerChars: readonly string[];
    /**
     * Try to match this construct anchored at `pos` (`text[pos]` is guaranteed
     * to be one of `triggerChars`). Returns the produced node and the
     * exclusive end index of the consumed source, or `null` when there is no
     * match.
     *
     * Two contracts the parser relies on:
     *  - **Streaming-safe**: return `null` on a partial tail (e.g. `@[lab`
     *    while expecting `@[label](id)`) — same contract as the built-in
     *    `scanLink`. The half-typed text degrades to literal and re-resolves
     *    once the rest arrives.
     *  - **Pure**: same `(text, pos)` → same result. The incremental engine
     *    memoizes finalized blocks by reference and only re-parses the live
     *    tail; an impure `match` breaks that invariant.
     *
     * The extension builds `node.raw` itself (it knows its own boundaries):
     * `raw` must equal `text.slice(pos, end)`.
     *
     * The tokenizer hardens against misbehaving matches — one that throws,
     * does not advance (`end <= pos`), or runs past the input
     * (`end > text.length`) is treated as no match, so the text degrades to
     * literal instead of breaking parsing.
     */
    match(text: string, pos: number): { node: InlineExtension; end: number } | null;
}

/** Union of all trigger chars, for the tokenizer's per-char fast path. */
export function buildTriggerSet(extensions: readonly ParserInlineExtension[]): Set<string> {
    const set = new Set<string>();
    for (const ext of extensions) for (const ch of ext.triggerChars) set.add(ch);
    return set;
}
