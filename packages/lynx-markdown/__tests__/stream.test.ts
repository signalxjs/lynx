import { describe, it, expect } from 'vitest';
import { createMarkdownStream } from '../src/stream';

describe('createMarkdownStream', () => {
    it('accumulates appended chunks into value (sync flush)', () => {
        const md = createMarkdownStream();
        md.append('# ');
        md.append('Hi');
        expect(md.value.value).toBe('# Hi');
    });

    it('coalesces appends within the flush interval', async () => {
        const md = createMarkdownStream({ flushIntervalMs: 40 });
        md.append('a');
        md.append('b');
        expect(md.value.value).toBe(''); // not flushed yet
        await new Promise((r) => setTimeout(r, 60));
        expect(md.value.value).toBe('ab');
    });

    it('done() flushes immediately and sets finished', () => {
        const md = createMarkdownStream({ flushIntervalMs: 1000 });
        md.append('x');
        expect(md.value.value).toBe('');
        md.done();
        expect(md.value.value).toBe('x');
        expect(md.finished.value).toBe(true);
    });

    it('reset() clears value and finished', () => {
        const md = createMarkdownStream();
        md.append('hello');
        md.done();
        md.reset();
        expect(md.value.value).toBe('');
        expect(md.finished.value).toBe(false);
    });

    it('ignores empty chunks', () => {
        const md = createMarkdownStream();
        md.append('');
        expect(md.value.value).toBe('');
    });
});
