import type { EmojiDatum, SkinTone } from './schema.js';

/**
 * The glyph to render/insert for `datum` under the given skin tone — the
 * tone variant when the emoji supports it, the base glyph otherwise
 * (objects, flags, mixed-tone-only emoji…).
 */
export function glyphForTone(datum: EmojiDatum, tone: SkinTone): string {
    if (tone === 0 || !datum.s) return datum.e;
    return datum.s[tone - 1] ?? datum.e;
}
