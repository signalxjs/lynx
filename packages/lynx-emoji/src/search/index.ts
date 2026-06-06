/**
 * Keyword search over an emoji dataset — pure JS, no signals, built once per
 * dataset and queried per keystroke (~1900 entries × a few terms each is
 * well under a millisecond; no inverted index needed).
 *
 * Ranking, highest first:
 *  1. exact shortcode (`:joy:` typed in full)
 *  2. shortcode prefix
 *  3. name-word prefix (first word of the name ranks above later words)
 *  4. keyword (CLDR tag) prefix
 *  5. name substring
 *
 * Multi-token queries (`"red heart"`) require every token to match; the
 * entry's score is the sum of per-token bests. Ties resolve by CLDR order.
 */

import type { EmojiData, EmojiDatum } from '../data/schema.js';

export interface EmojiSearchIndex {
    /** Ranked matches for `query`; `[]` for a blank query. */
    search(query: string, limit?: number): EmojiDatum[];
}

const SCORE_SHORTCODE_EXACT = 100;
const SCORE_SHORTCODE_PREFIX = 80;
const SCORE_NAME_FIRST_WORD_PREFIX = 70;
const SCORE_NAME_WORD_PREFIX = 60;
const SCORE_KEYWORD_PREFIX = 40;
const SCORE_NAME_SUBSTRING = 20;

const DEFAULT_LIMIT = 60;

interface IndexedEmoji {
    datum: EmojiDatum;
    name: string;
    nameWords: string[];
    keywords: string[];
    shortcodes: string[];
}

/** Lowercase and split a query into terms (`"Red  HEART"` → `['red','heart']`). */
export function tokenize(query: string): string[] {
    return query.toLowerCase().split(/[\s_-]+/).filter(Boolean);
}

export function buildSearchIndex(data: EmojiData): EmojiSearchIndex {
    // Normalize once at build time — CLDR names are mixed-case ("Santa
    // Claus", "T-Rex") and tag/shortcode casing is convention, not contract.
    const entries: IndexedEmoji[] = data.emojis.map((datum) => ({
        datum,
        name: datum.n.toLowerCase(),
        nameWords: tokenize(datum.n),
        keywords: (datum.k ?? []).map((k) => k.toLowerCase()),
        shortcodes: (datum.sc ?? []).map((sc) => sc.toLowerCase()),
    }));

    function scoreToken(entry: IndexedEmoji, token: string): number {
        let best = 0;
        for (const sc of entry.shortcodes) {
            if (sc === token) return SCORE_SHORTCODE_EXACT;
            if (sc.startsWith(token)) best = Math.max(best, SCORE_SHORTCODE_PREFIX);
        }
        for (let i = 0; i < entry.nameWords.length; i++) {
            if (entry.nameWords[i].startsWith(token)) {
                best = Math.max(best, i === 0 ? SCORE_NAME_FIRST_WORD_PREFIX : SCORE_NAME_WORD_PREFIX);
            }
        }
        if (best >= SCORE_KEYWORD_PREFIX) return best;
        for (const k of entry.keywords) {
            if (k.startsWith(token)) return SCORE_KEYWORD_PREFIX;
        }
        if (best === 0 && entry.name.includes(token)) return SCORE_NAME_SUBSTRING;
        return best;
    }

    return {
        search(query, limit = DEFAULT_LIMIT) {
            const tokens = tokenize(query);
            if (tokens.length === 0) return [];
            const scored: { datum: EmojiDatum; score: number }[] = [];
            for (const entry of entries) {
                let total = 0;
                for (const token of tokens) {
                    const s = scoreToken(entry, token);
                    if (s === 0) { total = 0; break; } // every token must match
                    total += s;
                }
                if (total > 0) scored.push({ datum: entry.datum, score: total });
            }
            scored.sort((a, b) => b.score - a.score || a.datum.o - b.datum.o);
            return scored.slice(0, limit).map((s) => s.datum);
        },
    };
}
