/**
 * #1215–#1217 against the INSTALLED skin: iOS lynx cannot decode an SVG
 * data-URI image (daisy's `--fx-noise` tile raised the dev red screen on
 * every checkbox and radio section) and does not apply `clip-path` (the
 * checkbox tick drew as a solid diamond, the dash as a top-half block).
 * zero-kit's lynx emitter refuses both from zero#401 on, and the daisy
 * checkbox draws its tick and dash without clip-path.
 *
 * A skin compiled before zero#401 still ships them — this guard arms itself
 * once the installed skin's report records the refusal (the batched zero
 * bump), then holds the shipped CSS to it.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const lynxDist = dirname(require.resolve('@sigx/zero-daisyui/lynx/manifest.json'));
const report = JSON.parse(readFileSync(require.resolve('@sigx/zero-daisyui/report.json'), 'utf8')) as {
    lynx?: { dropped?: { detail: string }[] };
};
const refuses = (issue: string): boolean =>
    (report.lynx?.dropped ?? []).some((f) => f.detail.includes(`signalxjs/lynx#${issue}`));
const css = (file: string): string => readFileSync(join(lynxDist, file), 'utf8');
/**
 * The declarations of the rule whose selector is exactly `selector`, however
 * the sheet is spaced. Fails loudly when the rule is missing, so a format
 * change cannot pass as an empty block.
 */
const block = (sheet: string, selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const body = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(sheet)?.[1];
    if (body === undefined) throw new Error(`no "${selector}" rule in the shipped CSS`);
    return body.replace(/\s+/g, ' ');
};

describe('shipped lynx CSS — no undecodable images, no clip-path (#1215–#1217)', () => {
    it.skipIf(!refuses('1215'))('carries no SVG data-URI image anywhere, and no noise layer', () => {
        const index = css('index.css');
        expect(index).not.toMatch(/data:image\/svg/i);
        expect(index).not.toContain('--fx-noise');
    });

    it.skipIf(!refuses('1216'))('carries no clip-path anywhere', () => {
        expect(css('index.css')).not.toMatch(/clip-path\s*:/);
    });

    it.skipIf(!refuses('1216'))('draws the checkbox tick as two borders and the dash as a centred bar', () => {
        const checkbox = css('components/checkbox.css');
        const tick = block(checkbox, '.zx-checkbox__indicator');
        expect(tick).toMatch(/border-right-width\s*:\s*calc\(/);
        expect(tick).toMatch(/border-bottom-width\s*:\s*calc\(/);
        expect(tick).toMatch(/transform\s*:\s*rotate\(45deg\)/);
        const dash = block(checkbox, '.zx-checkbox__indicator.zx-s-indeterminate');
        expect(dash).toMatch(/align-self\s*:\s*center/);
        expect(dash).toMatch(/border-right-width\s*:\s*0\b/);
        expect(dash).not.toMatch(/translate/);
    });
});
