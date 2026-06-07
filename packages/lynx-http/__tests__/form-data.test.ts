/**
 * Unit tests for `FormData` and its serialization to the native multipart
 * descriptor — including THE invariant: file bytes never cross the bridge.
 */
import { describe, expect, it } from 'vitest';
import { FormData, formDataToNativeBody, isFileHandle } from '../src/form-data.js';

describe('FormData — entry API', () => {
    it('append/get/getAll/has/delete round-trip', () => {
        const f = new FormData();
        f.append('a', '1');
        f.append('a', '2');
        f.append('b', '3');
        expect(f.get('a')).toBe('1');
        expect(f.getAll('a')).toEqual(['1', '2']);
        expect(f.has('b')).toBe(true);
        f.delete('a');
        expect(f.has('a')).toBe(false);
        expect(f.get('b')).toBe('3');
    });

    it('set replaces all entries of the name in place', () => {
        const f = new FormData();
        f.append('x', '1');
        f.append('y', '2');
        f.append('x', '3');
        f.set('x', 'replaced');
        expect([...f.keys()]).toEqual(['x', 'y']);
        expect(f.get('x')).toBe('replaced');
    });

    it('rejects values that are neither string nor file handle', () => {
        const f = new FormData();
        expect(() => f.append('n', 42 as unknown as string)).toThrow(TypeError);
        expect(() => f.append('n', { notAUri: true } as unknown as string)).toThrow(TypeError);
        // set() validates the same way as append().
        expect(() => f.set('n', 42 as unknown as string)).toThrow(TypeError);
        expect(() => f.set('n', { notAUri: true } as unknown as string)).toThrow(TypeError);
    });

    it('isFileHandle detects picker assets and RN-style objects', () => {
        expect(isFileHandle({ uri: 'file:///x', name: 'x', mimeType: 'a/b', size: 1 })).toBe(true);
        expect(isFileHandle({ uri: 'content://doc/1', name: 'x', type: 'a/b' })).toBe(true);
        expect(isFileHandle('a string')).toBe(false);
        expect(isFileHandle({ uri: '' })).toBe(false);
    });
});

describe('formDataToNativeBody', () => {
    it('serializes fields and file handles to descriptor parts', () => {
        const f = new FormData();
        f.append('purpose', 'attachment');
        f.append('file', { uri: 'file:///data/picked/report.pdf', name: 'report.pdf', mimeType: 'application/pdf', size: 1234 });
        const body = formDataToNativeBody(f);
        expect(body.type).toBe('multipart');
        expect(body.parts).toEqual([
            { kind: 'field', name: 'purpose', value: 'attachment' },
            {
                kind: 'file',
                name: 'file',
                uri: 'file:///data/picked/report.pdf',
                filename: 'report.pdf',
                contentType: 'application/pdf',
            },
        ]);
    });

    it('NEVER embeds file bytes or base64 in the descriptor', () => {
        const f = new FormData();
        f.append('file', { uri: 'content://provider/doc/9', name: 'big.bin', mimeType: 'application/octet-stream', size: 50_000_000 });
        const body = formDataToNativeBody(f);
        const serialized = JSON.stringify(body);
        // The only payload-bearing keys allowed for a file part:
        expect(Object.keys(body.parts[0]).sort()).toEqual(['contentType', 'filename', 'kind', 'name', 'uri']);
        // And nothing resembling inline data anywhere in the descriptor.
        expect(serialized).not.toContain('"data"');
        expect(serialized).not.toContain('"base64"');
        expect(serialized.length).toBeLessThan(500);
    });

    it('supports the RN {uri, name, type} convention', () => {
        const f = new FormData();
        f.append('photo', { uri: 'file:///tmp/p.jpg', name: 'p.jpg', type: 'image/jpeg' });
        const body = formDataToNativeBody(f);
        expect(body.parts[0]).toMatchObject({ kind: 'file', filename: 'p.jpg', contentType: 'image/jpeg' });
    });

    it('explicit filename argument wins over the handle name', () => {
        const f = new FormData();
        f.append('file', { uri: 'file:///tmp/x.bin', name: 'x.bin' }, 'renamed.bin');
        const body = formDataToNativeBody(f);
        expect(body.parts[0]).toMatchObject({ kind: 'file', filename: 'renamed.bin' });
    });

    it('keeps per-entry filenames when the same handle is appended twice', () => {
        const handle = { uri: 'file:///tmp/x.bin', name: 'x.bin' };
        const f = new FormData();
        f.append('file', handle, 'first.bin');
        f.append('file', handle, 'second.bin');
        f.append('file', handle); // no explicit filename → handle name
        const filenames = formDataToNativeBody(f).parts
            .map((p) => (p as { filename: string }).filename);
        expect(filenames).toEqual(['first.bin', 'second.bin', 'x.bin']);
    });

    it('falls back to application/octet-stream and "file" when metadata is missing', () => {
        const f = new FormData();
        f.append('file', { uri: 'content://doc/2' });
        const body = formDataToNativeBody(f);
        expect(body.parts[0]).toMatchObject({
            kind: 'file',
            filename: 'file',
            contentType: 'application/octet-stream',
        });
    });

    it('generates a unique boundary per serialization', () => {
        const f = new FormData();
        f.append('a', '1');
        const b1 = formDataToNativeBody(f).boundary;
        const b2 = formDataToNativeBody(f).boundary;
        expect(b1).toMatch(/^----SigxFormBoundary/);
        expect(b1).not.toBe(b2);
    });

    it('sanitizes CR/LF/quotes out of names and filenames', () => {
        const f = new FormData();
        f.append('na"me\r\n', { uri: 'file:///x', name: 'evil"\r\nname.txt' });
        const part = formDataToNativeBody(f).parts[0];
        expect(part.name).not.toMatch(/[\r\n"]/);
        expect((part as { filename: string }).filename).not.toMatch(/[\r\n"]/);
    });
});
