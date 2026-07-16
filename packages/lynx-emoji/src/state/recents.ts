import { signal, type Signal } from '@sigx/lynx';
import type { EmojiData, EmojiDatum } from '../data/schema.js';
import { loadString, saveString } from './persistence.js';

const KEY_RECENTS = '@sigx/lynx-emoji:recents';
const DEFAULT_CAP = 32;
const SAVE_DEBOUNCE_MS = 250;

export interface RecentsStore {
    /** Most-recent-first reactive array — read it inside render/computed. */
    recents: Signal<EmojiDatum[]>;
    /** Record a pick: moves/adds `datum` to the front (LRU, capped). */
    push(datum: EmojiDatum): void;
    /** Resolves once persisted recents have hydrated (or were absent). */
    loaded: Promise<void>;
}

/**
 * Recently-used emoji, persisted as the base glyphs (`e`) so the stored
 * shape survives dataset regeneration — on hydrate, glyphs that no longer
 * exist in the dataset are silently dropped, everything else re-resolves to
 * the live {@link EmojiDatum} (current names/keywords/skins).
 */
export function createRecentsStore(data: EmojiData, cap = DEFAULT_CAP): RecentsStore {
    const byGlyph = new Map(data.emojis.map((e) => [e.e, e]));
    const recents = signal<EmojiDatum[]>([]);

    // Hydration races a fast first pick: a push before getItem resolves must
    // win (the stored list it would be merged into is stale by definition).
    let touched = false;
    const loaded = loadString(KEY_RECENTS).then((raw) => {
        if (!raw || touched) return;
        try {
            const glyphs = JSON.parse(raw) as unknown;
            if (!Array.isArray(glyphs)) return;
            const items = glyphs
                .map((g) => (typeof g === 'string' ? byGlyph.get(g) : undefined))
                .filter((e): e is EmojiDatum => e !== undefined)
                .slice(0, cap);
            if (items.length && !touched) recents.$set(items);
        } catch {
            // corrupt payload — start fresh
        }
    }).catch(() => { /* hydrate failure = empty */ });

    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    function persist(): void {
        if (saveTimer !== undefined) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = undefined;
            saveString(KEY_RECENTS, JSON.stringify(recents.map((e) => e.e)));
        }, SAVE_DEBOUNCE_MS);
    }

    return {
        recents,
        loaded,
        push(datum) {
            touched = true;
            recents.$set([datum, ...recents.filter((e) => e.e !== datum.e)].slice(0, cap));
            persist();
        },
    };
}
