import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { GlyphData, IconAdapter } from '@sigx/lynx-icons';

const require = createRequire(import.meta.url);

const STYLE_TO_PACKAGE: Record<string, string> = {
    solid: '@fortawesome/free-solid-svg-icons',
    regular: '@fortawesome/free-regular-svg-icons',
    brands: '@fortawesome/free-brands-svg-icons',
};

const STYLE_TO_TTF: Record<string, string> = {
    solid: 'fa-solid-900.ttf',
    regular: 'fa-regular-400.ttf',
    brands: 'fa-brands-400.ttf',
};

interface FaIconEntry {
    prefix: string;
    iconName: string;
    icon: [number, number, unknown[], string, string];
}

const moduleCache = new Map<string, Record<string, FaIconEntry> | null>();

function loadStyleModule(style: string): Record<string, FaIconEntry> | null {
    if (moduleCache.has(style)) return moduleCache.get(style) ?? null;
    const pkg = STYLE_TO_PACKAGE[style];
    if (!pkg) {
        moduleCache.set(style, null);
        return null;
    }
    try {
        const mod = require(pkg) as Record<string, FaIconEntry>;
        moduleCache.set(style, mod);
        return mod;
    } catch {
        moduleCache.set(style, null);
        return null;
    }
}

/** Convert kebab-case glyph name → FA's PascalCase export name (`faChevronRight`). */
function exportNameFor(name: string): string {
    return 'fa' + name.split('-').map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1)).join('');
}

function webfontsDir(): string | null {
    try {
        const pkgJson = require.resolve('@fortawesome/fontawesome-free/package.json');
        return join(dirname(pkgJson), 'webfonts');
    } catch {
        return null;
    }
}

const adapter: IconAdapter = {
    styles: ['solid', 'regular', 'brands'],

    getGlyph(style: string, name: string): GlyphData | null {
        const mod = loadStyleModule(style);
        if (!mod) return null;
        const entry = mod[exportNameFor(name)];
        if (!entry || !Array.isArray(entry.icon)) return null;
        const [w, h, , unicodeHex, path] = entry.icon;
        const codepoint = parseInt(unicodeHex, 16);
        if (!Number.isFinite(codepoint)) return null;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" fill="__COLOR__"><path d="${path}"/></svg>`;
        return { codepoint, svg };
    },

    getFontPath(style: string): string | null {
        const filename = STYLE_TO_TTF[style];
        if (!filename) return null;
        const dir = webfontsDir();
        if (!dir) return null;
        return join(dir, filename);
    },
};

export default adapter;
