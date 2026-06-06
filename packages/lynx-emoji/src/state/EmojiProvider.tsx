import { component, defineProvide, type Define } from '@sigx/lynx';
import type { EmojiData } from '../data/schema.js';
import { createEmojiContext, useEmojiContext } from './context.js';

export type EmojiProviderProps =
    /** The locale dataset (`import data from '@sigx/lynx-emoji/data/en'`). Fixed at mount. */
    & Define.Prop<'data', EmojiData, true>
    & Define.Prop<'recentsCap', number, false>
    & Define.Slot<'default'>;

/**
 * Optional app-level provider: share one dataset + search index + recents +
 * skin-tone preference across every picker surface (composer panel, reaction
 * sheet, markdown toolbar…). Renders no element of its own.
 *
 * Pickers also work standalone — `<EmojiPicker data={…}>` without a provider
 * builds a private context. Use the provider when more than one surface
 * exists, so recents stay in sync without each surface re-hydrating.
 */
export const EmojiProvider = component<EmojiProviderProps>(({ props, slots }) => {
    const ctx = createEmojiContext(
        props.data,
        props.recentsCap !== undefined ? { recentsCap: props.recentsCap } : undefined,
    );
    defineProvide(useEmojiContext, () => ctx);

    return () => <>{slots.default?.()}</>;
});
