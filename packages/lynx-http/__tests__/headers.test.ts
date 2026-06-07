/**
 * Unit tests for the WHATWG-shaped `Headers`.
 */
import { describe, expect, it } from 'vitest';
import { Headers } from '../src/headers.js';

describe('Headers — init forms', () => {
    it('accepts a plain record', () => {
        const h = new Headers({ 'Content-Type': 'text/plain', Authorization: 'Bearer x' });
        expect(h.get('content-type')).toBe('text/plain');
        expect(h.get('AUTHORIZATION')).toBe('Bearer x');
    });

    it('accepts an array of pairs', () => {
        const h = new Headers([['Accept', 'application/json'], ['Accept', 'text/plain']]);
        expect(h.get('accept')).toBe('application/json, text/plain');
    });

    it('accepts another Headers instance', () => {
        const src = new Headers({ 'X-One': '1' });
        const h = new Headers(src);
        expect(h.get('x-one')).toBe('1');
    });

    it('rejects malformed pairs', () => {
        expect(() => new Headers([['only-name']] as unknown as Iterable<[string, string]>)).toThrow(TypeError);
    });
});

describe('Headers — semantics', () => {
    it('is case-insensitive across set/get/has/delete', () => {
        const h = new Headers();
        h.set('X-Token', 'abc');
        expect(h.has('x-token')).toBe(true);
        expect(h.get('X-TOKEN')).toBe('abc');
        h.delete('x-ToKeN');
        expect(h.has('X-Token')).toBe(false);
    });

    it('append combines values with ", " while set replaces', () => {
        const h = new Headers();
        h.append('Accept', 'a/b');
        h.append('Accept', 'c/d');
        expect(h.get('accept')).toBe('a/b, c/d');
        h.set('Accept', 'e/f');
        expect(h.get('accept')).toBe('e/f');
    });

    it('trims surrounding whitespace from values', () => {
        const h = new Headers();
        h.set('X-Pad', '  spaced  ');
        expect(h.get('x-pad')).toBe('spaced');
    });

    it('rejects invalid header names', () => {
        const h = new Headers();
        expect(() => h.set('bad name', 'x')).toThrow(TypeError);
        expect(() => h.set('', 'x')).toThrow(TypeError);
    });

    it('rejects embedded CR/LF/NUL in values (header injection)', () => {
        const h = new Headers();
        expect(() => h.set('x-a', 'evil\r\nX-Inject: 1')).toThrow(TypeError);
        expect(() => h.append('x-b', 'nul\0byte')).toThrow(TypeError);
        // Leading/trailing CR/LF is whitespace and trims fine.
        h.set('x-c', '\r\nok\r\n');
        expect(h.get('x-c')).toBe('ok');
    });

    it('iterates lowercase names in sorted order', () => {
        const h = new Headers({ Zebra: 'z', alpha: 'a', Mid: 'm' });
        expect([...h.keys()]).toEqual(['alpha', 'mid', 'zebra']);
        expect([...h]).toEqual([['alpha', 'a'], ['mid', 'm'], ['zebra', 'z']]);
    });

    it('toRecord flattens for the bridge spec', () => {
        const h = new Headers({ 'Content-Type': 'application/json', Authorization: 'Bearer t' });
        expect(h.toRecord()).toEqual({
            'content-type': 'application/json',
            authorization: 'Bearer t',
        });
    });
});
