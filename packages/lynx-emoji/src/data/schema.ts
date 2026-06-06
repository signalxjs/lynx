/**
 * The compact emoji dataset shape — what `scripts/gen-data.mjs` emits per
 * locale from `emojibase-data` (devDependency; never shipped). Keys are
 * single letters because ~1900 entries repeat them: the en dataset is ~30%
 * smaller minified than with descriptive keys.
 *
 * Regenerate with `pnpm -F @sigx/lynx-emoji gen:data` after bumping
 * `emojibase-data` (new Unicode releases) or adding locales to the
 * `LOCALES` list in the script.
 */

/** `0` = no modifier (the base glyph); `1..5` = light → dark (U+1F3FB–FF). */
export type SkinTone = 0 | 1 | 2 | 3 | 4 | 5;

export interface EmojiDatum {
    /** Native glyph — the fully-qualified unicode sequence. */
    e: string;
    /** Localized display name (CLDR annotation), lowercase. */
    n: string;
    /** Index into {@link EmojiData.categories}. */
    c: number;
    /** CLDR sort order (stable within the dataset). */
    o: number;
    /** Search keywords (CLDR tags), lowercase. */
    k?: string[];
    /** Shortcodes (emojibase set), lowercase, without the wrapping colons. */
    sc?: string[];
    /**
     * Uniform skin-tone variant glyphs, index `tone - 1` (so `s[0]` is the
     * light variant). Only present when all five uniform tones exist —
     * mixed-tone combinations (e.g. two-person handshakes) are not offered.
     */
    s?: string[];
}

export interface EmojiCategory {
    /** Stable key — the emojibase group key (`'smileys-emotion'`, …). */
    key: string;
    /** Localized label (`'smileys & emotion'`, …), lowercase. */
    label: string;
}

export interface EmojiData {
    /** BCP-47 locale the names/keywords/labels are in. */
    locale: string;
    /** Display order matches the CLDR group order (components excluded). */
    categories: EmojiCategory[];
    /** Sorted by `o`; category sections are contiguous runs. */
    emojis: EmojiDatum[];
    /** Localized skin-tone labels, index `tone - 1` (a11y). */
    skinTones: string[];
}
