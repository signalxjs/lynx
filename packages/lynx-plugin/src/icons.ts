/**
 * Icon-set integration for @sigx/lynx-icons.
 *
 * At plugin setup time this slice:
 *
 * 1. Loads `signalx.config.ts` and reads the `iconSets: [...]` field.
 * 2. Statically scans every `.tsx` / `.jsx` / `.ts` / `.js` file under the
 *    project root for icon usages (see `scanContent` for the exact patterns).
 * 3. Dynamically imports each adapter package (e.g. `@sigx/lynx-icons-fa-free`)
 *    and resolves the used glyphs to `{ codepoint, svg }` records.
 * 4. Writes three generated files into `node_modules/.cache/sigx-lynx-icons/`
 *    and aliases the `@sigx/lynx-icons/__codepoints` / `__svgs` / `__font-face.css`
 *    subpath imports to them, so Rspack tree-shakes everything else away.
 *
 * v1 emits SVG-mode artefacts only. Font-mode (build-time TTF subsetting +
 * base64-inlined @font-face) is a v1.1 follow-up; for now the generated
 * font-face.css is empty.
 *
 * The scanner is a one-shot regex pass at plugin start — adding a new icon
 * during `pnpm dev` requires a dev-server restart in v1. A real SWC-AST
 * Rspack loader is the planned upgrade and would obviate the regex
 * patterns by inspecting the JSX tree directly.
 *
 * **Patterns the scanner picks up (regex-based; not exhaustive):**
 * - `<Icon set="X" name="Y" />` — both attribute orders
 * - `<FaSolidIcon name="Y" />` / `<FaRegularIcon name="Y" />`
 *   / `<FaBrandIcon name="Y" />` / `<LucideIcon name="Y" />` — pinned
 *   components whose set id is hardcoded in their implementations. The
 *   set id mapping is in `PINNED_COMPONENTS` below.
 * - `{ set: 'X', name: 'Y' }` — `IconSpec` object literals anywhere
 *   (prop value, const declaration, function argument). Both key orders.
 *
 * **What still needs `include: [...]` in signalx.config.ts:**
 * - Dynamic names: `<Icon set="fas" name={someVar} />` or
 *   `<FaSolidIcon name={someVar} />` — the scanner only matches literal
 *   string attributes. JSON-driven UIs and runtime-computed icon names
 *   need explicit force-includes (or `include: ['*']` for the whole catalog).
 * - User-defined pinned components — only the four built-in adapter
 *   pinned components are known to the scanner. A consumer who writes
 *   their own `<MyIcon name="…">` wrapper needs `include`.
 * - Spread props: `<Icon {...spec} />`. Niche; use `include` if needed.
 */

import { createRequire } from 'node:module';
import { promises as fs, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RsbuildPluginAPI } from '@rsbuild/core';
import type { IconAdapter } from '@sigx/lynx-icons';
import type { ResolvedConfig, ResolvedIconSet } from '@sigx/lynx-cli';

const SCAN_REGEX_SET_FIRST =
    /<Icon\s+[^>]*?\bset\s*=\s*["']([\w-]+)["'][^>]*?\bname\s*=\s*["']([\w-]+)["']/g;
const SCAN_REGEX_NAME_FIRST =
    /<Icon\s+[^>]*?\bname\s*=\s*["']([\w-]+)["'][^>]*?\bset\s*=\s*["']([\w-]+)["']/g;

/**
 * Known pinned per-set components exported by the workspace's adapter
 * packages — `@sigx/lynx-icons-fa-free/components` and
 * `@sigx/lynx-icons-lucide/components`. Each hardcodes its `set` id to
 * the conventional value documented in the adapter's README; the
 * scanner mirrors that mapping so `<FaSolidIcon name="user" />` is
 * recognized as `set="fas", name="user"`.
 *
 * Consumers using non-conventional set ids in their config fall back
 * to generic `<Icon>` (the pinned component wouldn't find its set at
 * runtime either). New adapter packages adding pinned components add
 * their entries here; the eventual SWC-AST loader replaces this with
 * a per-package manifest.
 */
const PINNED_COMPONENTS: Readonly<Record<string, string>> = {
    FaSolidIcon: 'fas',
    FaRegularIcon: 'far',
    FaBrandIcon: 'fab',
    LucideIcon: 'lucide',
};

const PINNED_COMPONENT_NAMES = Object.keys(PINNED_COMPONENTS).join('|');
const SCAN_REGEX_PINNED = new RegExp(
    `<(${PINNED_COMPONENT_NAMES})\\s+[^>]*?\\bname\\s*=\\s*["']([\\w-]+)["']`,
    'g',
);

/**
 * `IconSpec` object literal matchers — `{ set: 'X', name: 'Y' }` in
 * either key order. Used for `<Tabs.Screen icon={{…}}>`, `<NavHeader
 * backIcon={{…}}>`, `const spec = {…}` const declarations, function
 * arguments, etc. Word-boundary anchored on the *first* key to avoid
 * matching mid-identifier (e.g. `someset:`). False positives — any
 * code object with both `set` and `name` string-valued keys — are
 * harmless: the extra glyph just ships in the bundle.
 */
const SCAN_REGEX_SPEC_SET_FIRST =
    /\bset\s*:\s*["']([\w-]+)["']\s*,\s*name\s*:\s*["']([\w-]+)["']/g;
const SCAN_REGEX_SPEC_NAME_FIRST =
    /\bname\s*:\s*["']([\w-]+)["']\s*,\s*set\s*:\s*["']([\w-]+)["']/g;

/** Directories to skip when walking the project. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'ios', 'android', 'Pods', '.git', '.cache', '.rspeedy']);

/** File extensions worth scanning. */
const SOURCE_EXT = /\.(?:tsx?|jsx?)$/;

async function walkSourceFiles(root: string): Promise<string[]> {
    const out: string[] = [];
    async function walk(dir: string): Promise<void> {
        let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
        try {
            entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        await Promise.all(
            entries.map(async (entry) => {
                if (entry.name.startsWith('.')) return;
                if (SKIP_DIRS.has(entry.name)) return;
                const full = join(dir, entry.name);
                if (entry.isDirectory()) return walk(full);
                if (entry.isFile() && SOURCE_EXT.test(entry.name)) out.push(full);
            }),
        );
    }
    await walk(root);
    return out;
}

function addUsage(used: Map<string, Set<string>>, set: string, name: string): void {
    let bucket = used.get(set);
    if (!bucket) {
        bucket = new Set();
        used.set(set, bucket);
    }
    bucket.add(name);
}

/**
 * Extract icon usages from a single source string. See the file-level
 * JSDoc for the complete pattern list. Exported for unit testing — the
 * prod path calls this once per file from {@link scanProject}.
 */
export function scanContent(content: string): Array<{ set: string; name: string }> {
    // Fast-path skip: a file with none of these markers can't possibly
    // contain an icon usage we'd match. `set:` covers both attribute and
    // object-literal forms; the pinned-component prefixes are listed for
    // the JSX form.
    if (
        !content.includes('<Icon')
        && !content.includes('<FaSolidIcon')
        && !content.includes('<FaRegularIcon')
        && !content.includes('<FaBrandIcon')
        && !content.includes('<LucideIcon')
        && !content.includes('set:')
    ) {
        return [];
    }
    const seen = new Set<string>();
    const out: Array<{ set: string; name: string }> = [];
    const push = (set: string, name: string): void => {
        const key = `${set}\0${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ set, name });
    };
    // <Icon set="X" name="Y" /> — either attribute order.
    for (const m of content.matchAll(SCAN_REGEX_SET_FIRST)) push(m[1], m[2]);
    for (const m of content.matchAll(SCAN_REGEX_NAME_FIRST)) push(m[2], m[1]);
    // <FaSolidIcon name="Y" /> etc. — set id resolved from PINNED_COMPONENTS.
    for (const m of content.matchAll(SCAN_REGEX_PINNED)) {
        const set = PINNED_COMPONENTS[m[1]];
        if (set) push(set, m[2]);
    }
    // { set: 'X', name: 'Y' } — IconSpec object literal, either key order.
    for (const m of content.matchAll(SCAN_REGEX_SPEC_SET_FIRST)) push(m[1], m[2]);
    for (const m of content.matchAll(SCAN_REGEX_SPEC_NAME_FIRST)) push(m[2], m[1]);
    return out;
}

async function scanProject(cwd: string): Promise<Map<string, Set<string>>> {
    const used = new Map<string, Set<string>>();
    const files = await walkSourceFiles(cwd);
    await Promise.all(
        files.map(async (file) => {
            const content = await fs.readFile(file, 'utf8').catch(() => '');
            for (const { set, name } of scanContent(content)) addUsage(used, set, name);
        }),
    );
    return used;
}

async function loadAdapter(cwd: string, source: string): Promise<IconAdapter | null> {
    try {
        const cwdRequire = createRequire(join(cwd, 'noop.js'));
        const adapterPath = cwdRequire.resolve(source);
        // Wrap with file:// — Windows ESM rejects bare absolute paths in dynamic
        // import(). Same pattern as packages/lynx-cli/src/prebuild.ts loadConfig.
        const mod = (await import(pathToFileURL(adapterPath).href)) as { default?: IconAdapter } & IconAdapter;
        return mod.default ?? (mod as IconAdapter);
    } catch (err) {
        // Adapter not installed — silently skip; consumer will see missing-icon placeholders.
        if (process.env['SIGX_DEBUG_ICONS']) {
            // eslint-disable-next-line no-console
            console.warn(`[@sigx/lynx-plugin] icons: failed to load adapter "${source}":`, err);
        }
        return null;
    }
}

interface GlyphResult {
    codepoint?: number;
    svg: string;
}

function collectGlyphsForSet(
    adapter: IconAdapter,
    setConfig: ResolvedIconSet,
    usedNames: ReadonlySet<string>,
): { codepoints: Record<string, number>; svgs: Record<string, GlyphResult> } {
    const codepoints: Record<string, number> = {};
    const svgs: Record<string, GlyphResult> = {};
    const stylesToTry = setConfig.styles ?? adapter.styles;

    // v1 contract: codepoint and svg are MUTUALLY EXCLUSIVE per set so the
    // runtime can pick a render strategy without ambiguity. v1 only ships
    // SVG mode (no @font-face CSS generation yet), so we never emit
    // codepoints — even when the adapter returns them. v1.1's font-mode work
    // flips the switch by emitting codepoints + matching @font-face CSS for
    // sets whose `mode` is 'font'.
    const emitCodepoints = false;

    for (const name of usedNames) {
        let glyph = null;
        for (const style of stylesToTry) {
            glyph = adapter.getGlyph(style, name);
            if (glyph) break;
        }
        if (!glyph) continue;
        if (emitCodepoints && glyph.codepoint !== undefined) {
            codepoints[name] = glyph.codepoint;
        } else {
            svgs[name] = { svg: glyph.svg };
        }
    }
    return { codepoints, svgs };
}

/**
 * Wire `@sigx/lynx-icons` adapter packages declared in `signalx.config.ts`.
 * Called from {@link pluginSigxLynx}'s `setup()` after the dev/asset patches.
 */
export async function applyIcons(
    api: RsbuildPluginAPI,
    opts: { cwd?: string } = {},
): Promise<void> {
    const cwd = opts.cwd ?? process.cwd();

    // Two layered concerns:
    // 1. No config / lynx-cli not installed → silent no-op (genuine non-Lynx context).
    // 2. Config exists but loadConfig / resolveConfig throws → surface the error so a
    //    typo in iconSets (duplicate ids, unknown styles/modes) doesn't silently
    //    swallow itself and leave the user wondering why icons render as placeholders.
    const configCandidates = [
        'signalx.config.ts',
        'signalx.config.js',
        'signalx.config.mjs',
    ];
    const hasConfig = configCandidates.some((f) => existsSync(join(cwd, f)));
    if (!hasConfig) return;

    let cli: typeof import('@sigx/lynx-cli');
    try {
        cli = (await import('@sigx/lynx-cli')) as typeof import('@sigx/lynx-cli');
    } catch {
        // @sigx/lynx-cli is an optional peer dep; consumer outside a sigx-lynx app — skip.
        return;
    }

    // From here errors are real (bad config / failed validation) — let them throw
    // so the build fails loudly. eslint-disable + console.error keeps the message
    // visible even when the throw is wrapped by rsbuild.
    const raw = await cli.loadConfig(cwd);
    const config: ResolvedConfig = cli.resolveConfig(raw);

    if (!config.iconSets || config.iconSets.length === 0) return;

    const used = await scanProject(cwd);

    const codepointsMap: Record<string, Record<string, number>> = {};
    const svgsMap: Record<string, Record<string, GlyphResult>> = {};

    for (const setConfig of config.iconSets) {
        const adapter = await loadAdapter(cwd, setConfig.source);
        if (!adapter) continue;

        const setUsed = new Set(used.get(setConfig.id) ?? []);
        for (const forced of setConfig.include) setUsed.add(forced);

        // `include: ['*']` → ship the full glyph catalog for each configured
        // style. Required for JSON-driven UIs where icon names are unknown
        // at build time. Trade-off: bundle grows by hundreds of KB.
        if (setConfig.include.includes('*')) {
            setUsed.delete('*');
            const stylesToTry = setConfig.styles ?? adapter.styles;
            for (const style of stylesToTry) {
                for (const name of adapter.listGlyphs(style)) setUsed.add(name);
            }
            // eslint-disable-next-line no-console
            console.log(
                `[@sigx/lynx-plugin] icons: ${setConfig.id} bundling ${setUsed.size} glyphs (include: ['*'])`,
            );
        }

        if (setUsed.size === 0) continue;

        const { codepoints, svgs } = collectGlyphsForSet(adapter, setConfig, setUsed);
        if (Object.keys(codepoints).length > 0) codepointsMap[setConfig.id] = codepoints;
        if (Object.keys(svgs).length > 0) svgsMap[setConfig.id] = svgs;
    }

    // Persist generated modules into the project's pnpm cache dir.
    const cacheDir = join(cwd, 'node_modules', '.cache', 'sigx-lynx-icons');
    await fs.mkdir(cacheDir, { recursive: true });
    const codepointsPath = join(cacheDir, 'codepoints.mjs');
    const svgsPath = join(cacheDir, 'svgs.mjs');
    const fontFacePath = join(cacheDir, 'font-face.css');

    await fs.writeFile(
        codepointsPath,
        `// Auto-generated by @sigx/lynx-plugin — do not edit.\nexport const codepoints = ${JSON.stringify(codepointsMap)};\n`,
    );
    await fs.writeFile(
        svgsPath,
        `// Auto-generated by @sigx/lynx-plugin — do not edit.\nexport const svgs = ${JSON.stringify(svgsMap)};\n`,
    );
    await fs.writeFile(
        fontFacePath,
        '/* Auto-generated by @sigx/lynx-plugin — font mode lands in v1.1. */\n',
    );

    // Alias the three subpath imports to the generated files.
    api.modifyBundlerChain((chain) => {
        chain.resolve.alias.set('@sigx/lynx-icons/__codepoints', codepointsPath);
        chain.resolve.alias.set('@sigx/lynx-icons/__svgs', svgsPath);
        chain.resolve.alias.set('@sigx/lynx-icons/__font-face.css', fontFacePath);
    });
}
