import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { XMarkdown } from '../src/XMarkdown';

describe('XMarkdown (native <x-markdown> wrapper)', () => {
    it('emits an <x-markdown> element with the markdown source as a child', () => {
        const { container } = render(<XMarkdown value="# Hello" effect="typewriter" />);
        const el = container.findByType('x-markdown');
        expect(el).toBeTruthy();
        expect(el!.props['markdown-effect']).toBe('typewriter');
        expect(container.findByText('# Hello')).toBeTruthy();
    });

    it('defaults to an empty string child when value is omitted', () => {
        const { container } = render(<XMarkdown />);
        expect(container.findByType('x-markdown')).toBeTruthy();
    });
});
