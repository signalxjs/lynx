import { describe, expect, it } from 'vitest';
import { createURL, parse } from '../src/parse';

describe('parse', () => {
    it('parses a custom-scheme URL with host, path, and query', () => {
        expect(parse('myapp://host/path?a=1&b=two')).toEqual({
            scheme: 'myapp',
            hostname: 'host',
            path: '/path',
            queryParams: { a: '1', b: 'two' },
        });
    });

    it('lowercases the scheme', () => {
        expect(parse('MyApp://Host/Path').scheme).toBe('myapp');
    });

    it('parses an https URL', () => {
        expect(parse('https://example.com/foo/bar?x=y')).toEqual({
            scheme: 'https',
            hostname: 'example.com',
            path: '/foo/bar',
            queryParams: { x: 'y' },
        });
    });

    it('handles a URL with no path', () => {
        expect(parse('https://example.com')).toEqual({
            scheme: 'https',
            hostname: 'example.com',
            path: '',
            queryParams: {},
        });
    });

    it('handles a URL with only a query, no path', () => {
        expect(parse('myapp://host?token=abc')).toEqual({
            scheme: 'myapp',
            hostname: 'host',
            path: '',
            queryParams: { token: 'abc' },
        });
    });

    it('parses opaque schemes (no //)', () => {
        expect(parse('mailto:test@example.com')).toEqual({
            scheme: 'mailto',
            hostname: '',
            path: 'test@example.com',
            queryParams: {},
        });
        expect(parse('tel:+15551234')).toEqual({
            scheme: 'tel',
            hostname: '',
            path: '+15551234',
            queryParams: {},
        });
    });

    it('strips fragments', () => {
        expect(parse('https://example.com/path?x=1#section')).toEqual({
            scheme: 'https',
            hostname: 'example.com',
            path: '/path',
            queryParams: { x: '1' },
        });
    });

    it('decodes percent-encoded query values', () => {
        expect(parse('myapp://x?msg=hello%20world&email=a%40b.com').queryParams).toEqual({
            msg: 'hello world',
            email: 'a@b.com',
        });
    });

    it('treats + as space in query values', () => {
        expect(parse('myapp://x?q=hello+world').queryParams).toEqual({ q: 'hello world' });
    });

    it('returns empty string for keyless query params', () => {
        expect(parse('myapp://x?flag').queryParams).toEqual({ flag: '' });
    });

    it('falls through gracefully on bare paths (no scheme)', () => {
        expect(parse('/just/a/path?x=1')).toEqual({
            scheme: '',
            hostname: '',
            path: '/just/a/path?x=1',
            queryParams: {},
        });
    });

    it('throws on non-string input', () => {
        expect(() => parse(undefined as unknown as string)).toThrow(TypeError);
    });
});

describe('createURL', () => {
    it('returns the path unchanged when no params are given', () => {
        expect(createURL('/foo/bar')).toBe('/foo/bar');
    });

    it('appends a query string', () => {
        expect(createURL('/foo', { a: '1', b: 'two' })).toBe('/foo?a=1&b=two');
    });

    it('percent-encodes keys and values', () => {
        expect(createURL('/x', { 'a key': 'hello world' })).toBe('/x?a%20key=hello%20world');
    });

    it('appends with & when path already has a query', () => {
        expect(createURL('/foo?existing=1', { added: '2' })).toBe('/foo?existing=1&added=2');
    });

    it('skips undefined values', () => {
        expect(createURL('/x', { a: '1', b: undefined as unknown as string })).toBe('/x?a=1');
    });
});
