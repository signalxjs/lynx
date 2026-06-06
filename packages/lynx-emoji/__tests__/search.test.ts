import { describe, it, expect } from 'vitest';
import { data } from '../src/data/en.gen';
import { buildSearchIndex, tokenize } from '../src/search/index';

const index = buildSearchIndex(data);

describe('tokenize', () => {
    it('lowercases and splits on whitespace/underscore/hyphen', () => {
        expect(tokenize('Red  HEART')).toEqual(['red', 'heart']);
        expect(tokenize('thumbs_up')).toEqual(['thumbs', 'up']);
        expect(tokenize('medium-dark')).toEqual(['medium', 'dark']);
        expect(tokenize('  ')).toEqual([]);
    });
});

describe('search', () => {
    it('returns nothing for a blank query', () => {
        expect(index.search('')).toEqual([]);
        expect(index.search('   ')).toEqual([]);
    });

    it('ranks an exact shortcode first', () => {
        expect(index.search('joy')[0].e).toBe('😂');
        expect(index.search('fire')[0].e).toBe('🔥');
    });

    it('matches name-word prefixes', () => {
        const hits = index.search('wav');
        expect(hits.some((e) => e.n === 'waving hand')).toBe(true);
    });

    it('matches keywords', () => {
        // 'hello' is a CLDR tag of waving hand, not part of its name.
        const hits = index.search('hello');
        expect(hits.some((e) => e.n === 'waving hand')).toBe(true);
    });

    it('requires every token to match', () => {
        const hits = index.search('red heart');
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].n).toBe('red heart');
        expect(index.search('red zzzz')).toEqual([]);
    });

    it('is case-insensitive and respects the limit', () => {
        expect(index.search('FIRE')[0].e).toBe('🔥');
        expect(index.search('face', 5)).toHaveLength(5);
    });

    it('returns no hits for nonsense', () => {
        expect(index.search('xqzzy')).toEqual([]);
    });
});
