import { describe, it, expect } from 'vitest';
import { data } from '../src/data/en.gen';
import { createRecentsStore } from '../src/state/recents';
import { createSkinToneStore } from '../src/state/skinTone';

const [a, b, c] = data.emojis;

describe('createRecentsStore', () => {
    it('starts empty and records picks most-recent-first', () => {
        const store = createRecentsStore(data);
        expect([...store.recents]).toEqual([]);
        store.push(a);
        store.push(b);
        expect(store.recents.map((e) => e.e)).toEqual([b.e, a.e]);
    });

    it('moves a re-picked emoji to the front without duplicating', () => {
        const store = createRecentsStore(data);
        store.push(a);
        store.push(b);
        store.push(c);
        store.push(a);
        expect(store.recents.map((e) => e.e)).toEqual([a.e, c.e, b.e]);
    });

    it('caps the list', () => {
        const store = createRecentsStore(data, 3);
        for (const e of data.emojis.slice(0, 5)) store.push(e);
        expect(store.recents).toHaveLength(3);
        expect(store.recents[0].e).toBe(data.emojis[4].e);
    });
});

describe('createSkinToneStore', () => {
    it('defaults to no tone and updates on set', () => {
        const store = createSkinToneStore();
        expect(store.state.tone).toBe(0);
        store.set(3);
        expect(store.state.tone).toBe(3);
        store.set(0);
        expect(store.state.tone).toBe(0);
    });
});
