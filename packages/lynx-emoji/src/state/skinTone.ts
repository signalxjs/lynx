import { signal, type Signal } from '@sigx/lynx';
import type { SkinTone } from '../data/schema.js';
import { loadString, saveString } from './persistence.js';

const KEY_SKIN_TONE = '@sigx/lynx-emoji:skin-tone';

export interface SkinToneStore {
    /** Reactive — read `.tone` inside render/computed. */
    state: Signal<{ tone: SkinTone }>;
    /** Set the sticky preference (applies grid-wide, persists immediately). */
    set(tone: SkinTone): void;
}

/**
 * The sticky skin-tone preference — one tone for the whole picker (the
 * WhatsApp/Telegram model: pick once via long-press, every tonal emoji
 * renders and inserts that variant until changed).
 */
export function createSkinToneStore(): SkinToneStore {
    const state = signal<{ tone: SkinTone }>({ tone: 0 });

    let touched = false;
    void loadString(KEY_SKIN_TONE).then((raw) => {
        if (raw === null || touched) return;
        const tone = Number(raw);
        if (tone >= 0 && tone <= 5 && Number.isInteger(tone)) {
            state.$set({ tone: tone as SkinTone });
        }
    });

    return {
        state,
        set(tone) {
            touched = true;
            state.$set({ tone });
            saveString(KEY_SKIN_TONE, String(tone));
        },
    };
}
