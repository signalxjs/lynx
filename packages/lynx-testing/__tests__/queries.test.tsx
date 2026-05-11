import { describe, it, expect } from 'vitest';
import { render } from '../src/index.js';
import { jsx } from '@sigx/lynx';

describe('queries', () => {
  describe('getByType / queryByType', () => {
    it('returns the first descendant of the given type', () => {
      const { getByType } = render(
        jsx('view', {
          children: [
            jsx('text', { id: 'first', children: 'one' }),
            jsx('text', { id: 'second', children: 'two' }),
          ],
        }),
      );
      expect(getByType('text').props.id).toBe('first');
    });

    it('throws a descriptive error when no node matches', () => {
      const { getByType } = render(jsx('view', { children: [] }));
      expect(() => getByType('image')).toThrowError(/No element found with type "image"/);
    });

    it('queryByType returns null when no node matches (no throw)', () => {
      const { queryByType } = render(jsx('view', { children: [] }));
      expect(queryByType('image')).toBeNull();
    });
  });

  describe('getAllByType', () => {
    it('returns every descendant of the given type, deeply', () => {
      const { getAllByType } = render(
        jsx('view', {
          children: [
            jsx('text', { children: 'a' }),
            jsx('view', {
              children: [
                jsx('text', { children: 'b' }),
                jsx('text', { children: 'c' }),
              ],
            }),
          ],
        }),
      );
      const texts = getAllByType('text');
      expect(texts).toHaveLength(3);
      expect(texts.map(n => n.textContent())).toEqual(['a', 'b', 'c']);
    });

    it('returns an empty array when nothing matches', () => {
      const { getAllByType } = render(jsx('view', { children: [] }));
      expect(getAllByType('image')).toEqual([]);
    });
  });

  describe('getByText / queryByText', () => {
    it('matches a substring of the rendered text', () => {
      const { getByText } = render(
        jsx('view', { children: [jsx('text', { children: 'Hello, World' })] }),
      );
      expect(getByText('World').textContent()).toBe('Hello, World');
    });

    it('throws a descriptive error when no node matches', () => {
      const { getByText } = render(jsx('view', { children: [] }));
      expect(() => getByText('nope')).toThrowError(/No element found with text "nope"/);
    });

    it('queryByText returns null when no node matches', () => {
      const { queryByText } = render(jsx('view', { children: [] }));
      expect(queryByText('nope')).toBeNull();
    });
  });

  describe('getByProp', () => {
    it('finds a node by an arbitrary prop key/value', () => {
      const { getByProp } = render(
        jsx('view', {
          children: [
            jsx('view', { id: 'outer', children: [jsx('text', { id: 'target', children: 'x' })] }),
          ],
        }),
      );
      expect(getByProp('id', 'target').type).toBe('text');
    });

    it('throws when no node matches', () => {
      const { getByProp } = render(jsx('view', { children: [] }));
      expect(() => getByProp('id', 'nope')).toThrowError(/No element found with id="nope"/);
    });
  });

  describe('debug()', () => {
    it('serializes the tree to a readable string', () => {
      const { debug } = render(
        jsx('view', { id: 'root', children: [jsx('text', { children: 'hi' })] }),
      );
      const out = debug();
      expect(out).toContain('<view');
      expect(out).toContain('id="root"');
      expect(out).toContain('"hi"');
    });
  });
});
