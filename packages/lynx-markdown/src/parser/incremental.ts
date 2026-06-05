/**
 * Incremental parsing engine for streaming markdown.
 *
 * The win for AI chat output: as the source string grows token-by-token, we
 * never re-parse or re-render finalized content, and completed blocks keep a
 * stable identity so the reconciler never remounts (no flicker / reflow).
 *
 * Core invariant: for an append-only stream, only the **last** top-level block
 * can still change — appended text always extends the final block. So when a
 * parse of the live tail yields N blocks, the first N−1 are finalized: they are
 * cached by reference and never rebuilt, and the source cursor advances to the
 * start of the last block. Each subsequent chunk re-parses only that trailing
 * block region (≈ O(last block), not O(document)).
 *
 * Keys are the absolute block index (`b-<i>`), so a block keeps the same key
 * when it transitions from live → finalized: the reconciler patches in place
 * rather than remounting.
 */

import type { BlockNode } from '../ast.js';
import { parseBlocks, makeKeyGen } from './blocks.js';
import type { ParserInlineExtension } from './extensions.js';
import { normalize } from './scanner.js';

export interface IncrementalEngine {
    /** Parse `src`, reusing finalized blocks from prior calls where possible. */
    parse(src: string): BlockNode[];
    /** Drop all cached state (e.g. when the source is replaced, not appended). */
    reset(): void;
}

export interface IncrementalEngineOptions {
    /**
     * Inline extensions threaded into every parse. Captured at construction —
     * extensions are configuration, not data: to change the set, create a new
     * engine. Each `match` must be pure, or finalized-block reuse breaks.
     */
    extensions?: readonly ParserInlineExtension[];
}

export function createIncrementalEngine(options?: IncrementalEngineOptions): IncrementalEngine {
    // Snapshot so in-place mutation of the caller's array can't change parse
    // behavior under cached finalized blocks (the "captured config" guarantee).
    const extensions = options?.extensions ? [...options.extensions] : undefined;
    /** Finalized blocks, frozen and reused by reference across chunks. */
    let cached: BlockNode[] = [];
    /** Source length (in normalized chars) already folded into `cached`. */
    let cut = 0;
    /** The normalized source prefix corresponding to `cached` (`src.slice(0, cut)`). */
    let stableSource = '';

    const reset = (): void => {
        cached = [];
        cut = 0;
        stableSource = '';
    };

    const assignKey = (block: BlockNode, index: number): void => {
        block.key = `b-${index}`;
    };

    const parse = (src: string): BlockNode[] => {
        const norm = normalize(src ?? '');

        // Non-append edit (regenerate, replace): the cached prefix no longer
        // matches → full re-parse.
        if (!norm.startsWith(stableSource)) reset();

        const tail = norm.slice(cut);
        const blocks = parseBlocks(tail, makeKeyGen(`p${cut}`), extensions);

        if (blocks.length === 0) {
            // Tail is empty / all-blank: nothing live, return finalized prefix.
            return cached.slice();
        }

        // Finalize every block except the last (the only one that can still grow).
        if (blocks.length > 1) {
            const finalized = blocks.slice(0, -1);
            finalized.forEach((b, i) => assignKey(b, cached.length + i));
            cached = cached.concat(finalized);

            const last = blocks[blocks.length - 1];
            const idx = tail.lastIndexOf(last.raw);
            cut += idx < 0 ? 0 : idx;
            stableSource = norm.slice(0, cut);

            assignKey(last, cached.length);
            return cached.concat(last);
        }

        const live = blocks[0];
        assignKey(live, cached.length);
        return cached.concat(live);
    };

    return { parse, reset };
}
