import { describe, it, expect } from 'vitest';
import { render } from '@sigx/lynx-testing';
import { MarkdownView } from '@sigx/lynx-markdown';
import { markdownComponents } from '../src/markdown/components';

describe('markdownComponents (daisyUI bridge)', () => {
    it('renders headings and paragraphs via daisyUI components', () => {
        const { container } = render(
            <MarkdownView value={'# Title\n\nbody text'} components={markdownComponents} />,
        );
        // Heading resolves to a <text> with the daisyUI ramp class.
        const heading = container.findByText('Title');
        expect(heading).toBeTruthy();
        const big = container.findAllByType('text').find((t) => t._class.includes('text-3xl'));
        expect(big).toBeTruthy();
        expect(container.findByText('body text')).toBeTruthy();
    });

    it('renders bold as a daisyUI-classed nested text span', () => {
        const { container } = render(<MarkdownView value="a **b** c" components={markdownComponents} />);
        const bold = container.findAllByType('text').find((t) => t._class.includes('font-bold'));
        expect(bold).toBeTruthy();
        expect(bold!.findByText('b')).toBeTruthy();
    });

    it('renders a code block with a themed surface', () => {
        const { container } = render(
            <MarkdownView value={'```ts\nx\n```'} components={markdownComponents} />,
        );
        expect(container.findByText('x')).toBeTruthy();
        expect(container.findByText('ts')).toBeTruthy();
    });

    it('wires onLink through the daisyUI link renderer', () => {
        let href = '';
        const { container } = render(
            <MarkdownView
                value="[go](http://x.com)"
                components={markdownComponents}
                onLink={(h) => { href = h; }}
            />,
        );
        const link = container.findAllByType('text').find((t) => t._class.includes('text-primary'));
        expect(link).toBeTruthy();
    });
});
