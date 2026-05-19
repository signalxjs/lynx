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

/**
 * Inverse of `exportNameFor`: `faChevronRight` → `chevron-right`.
 * Used by `listGlyphs` to walk `Object.keys(module)` and emit canonical names.
 */
function kebabFromExportName(exportName: string): string {
    // Strip the leading `fa` prefix.
    const body = exportName.slice(2);
    if (body.length === 0) return '';
    // Split on each uppercase letter and join with `-`, lowercasing everything.
    let out = body.charAt(0).toLowerCase();
    for (let i = 1; i < body.length; i++) {
        const ch = body.charAt(i);
        if (ch >= 'A' && ch <= 'Z') {
            out += '-' + ch.toLowerCase();
        } else {
            out += ch;
        }
    }
    return out;
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

    listGlyphs(style: string): string[] {
        const mod = loadStyleModule(style);
        if (!mod) return [];
        const out: string[] = [];
        for (const [key, entry] of Object.entries(mod)) {
            // The FA modules also export `prefix` ('fas' / 'far' / 'fab') and a
            // single-letter alias matching the prefix. Filter to real icon
            // entries — objects with a numeric icon[0] and a string icon[4].
            if (!key.startsWith('fa') || key.length < 3) continue;
            const ch = key.charAt(2);
            if (ch < 'A' || ch > 'Z') continue; // skip `fas`, `far`, `fab`
            if (!entry || typeof entry !== 'object' || !Array.isArray((entry as FaIconEntry).icon)) continue;
            out.push(kebabFromExportName(key));
        }
        return out;
    },
};

export default adapter;
