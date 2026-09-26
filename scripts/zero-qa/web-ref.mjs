#!/usr/bin/env node
/**
 * web-ref — capture the WEB daisy reference of the same scopes from zero's
 * playground (#1141), so the contact sheet shows lynx beside the web skin.
 *
 *   node scripts/zero-qa/web-ref.mjs --scope button,switch [--run-dir .zero-qa/<run>]
 *        [--zero <path to a zero checkout>] [--port 5299] [--ds daisyui] [--color-scheme light|dark]
 *
 * Boots the playground's vite dev server (reusing one already on --port),
 * drives zero's own Playwright install (no new dependency here) at iPhone
 * width (402pt, 3x — the simulator's geometry), pins the design system the
 * way zero's e2e does (localStorage `zero-ds` before load), opens
 * `/#/<scope>`, and saves the page's demo `<article>` (without the
 * stacked sidebar and toolbar) as a PNG at `<run-dir>/<scope>/web.png`,
 * recorded under `web` in the run's `run.json`.
 *
 * The playground's page ids are zero's scope names (`#/button`, `#/switch`),
 * and its pages are demos, not the lynx gallery's axis × state matrix — the
 * reference is the skin's own look, not a pixel twin of a section.
 *
 * Needs a built zero checkout (`pnpm build` at its root: the playground
 * resolves each skin's compiled CSS from dist/) and its Playwright browsers
 * (`pnpm exec playwright install chromium` there).
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const value = process.argv[i + 1];
    return value === undefined || value.startsWith('--') ? true : value;
}

/** `<parent of the lynx repo dir>/zero/main` — the sigx checkout layout. */
function defaultZero() {
    if (process.env.ZERO_REPO) return process.env.ZERO_REPO;
    try {
        const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: REPO, encoding: 'utf8' }).trim();
        // <sigx>/lynx/main/.git → <sigx>/zero/main
        return resolve(common, '..', '..', '..', 'zero', 'main');
    } catch {
        return resolve(REPO, '..', 'zero');
    }
}

async function reachable(url) {
    try {
        const res = await fetch(url);
        return res.ok;
    } catch {
        return false;
    }
}

async function waitFor(url, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (await reachable(url)) return true;
        await new Promise((r) => setTimeout(r, 500));
    }
    return false;
}

/** Stop the dev server and its children (pnpm does not forward signals to vite). */
function stopServer(child) {
    try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-child.pid, 'SIGTERM');
    } catch {
        child.kill();
    }
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function main() {
    const scopes = String(arg('scope', '')).split(',').map((s) => s.split('/')[0].trim()).filter(Boolean);
    if (scopes.length === 0) {
        console.error('usage: web-ref.mjs --scope <scope>[,<scope>…] [--run-dir <dir>] [--zero <path>] [--port 5299] [--ds daisyui]');
        return 2;
    }
    const zero = resolve(String(arg('zero', defaultZero())));
    const playground = join(zero, 'examples', 'playground');
    if (!existsSync(join(playground, 'package.json'))) {
        console.error(`zero playground not found at ${playground} — pass --zero <checkout> or set ZERO_REPO`);
        return 1;
    }
    let playwright;
    const requireFromPlayground = createRequire(join(playground, 'package.json'));
    try {
        // The playground depends on @playwright/test, which re-exports the browsers.
        playwright = requireFromPlayground('@playwright/test');
    } catch {
        console.error(`playwright is not installed in ${playground} — run \`pnpm install\` in the zero checkout`);
        return 1;
    }

    const port = Number(arg('port', 5299));
    const ds = String(arg('ds', 'daisyui'));
    const colorScheme = String(arg('color-scheme', 'light'));
    const base = `http://localhost:${port}`;
    const runDir = resolve(String(arg('run-dir', join(REPO, '.zero-qa', `${stamp()}-web`))));
    mkdirSync(runDir, { recursive: true });

    let server = null;
    if (!(await reachable(base))) {
        console.log(`starting the zero playground on :${port} …`);
        server = spawn('pnpm', ['dev', '--port', String(port), '--strictPort'], {
            cwd: playground,
            stdio: 'ignore',
            shell: process.platform === 'win32',
            // Own process group, so stopping it takes vite down with pnpm.
            detached: process.platform !== 'win32',
        });
        if (!(await waitFor(base, 60_000))) {
            stopServer(server);
            console.error(`the playground did not come up on ${base}`);
            return 1;
        }
    }

    const manifestPath = join(runDir, 'run.json');
    const run = existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, 'utf8'))
        : { run: relative(join(REPO, '.zero-qa'), runDir), createdAt: new Date().toISOString(), shots: [] };
    run.web = (run.web ?? []).filter((w) => !scopes.includes(w.scope));

    const browser = await playwright.chromium.launch();
    try {
        const context = await browser.newContext({
            viewport: { width: 402, height: 874 },
            deviceScaleFactor: 3,
            hasTouch: true,
            isMobile: true,
            colorScheme,
        });
        await context.addInitScript((id) => localStorage.setItem('zero-ds', id), ds);
        const page = await context.newPage();
        for (const scope of scopes) {
            const url = `${base}/#/${scope}`;
            await page.goto(url);
            try {
                await page.locator(`link[data-zero-ds="${ds}"]:not([media])`).waitFor({ state: 'attached', timeout: 15_000 });
                await page.evaluate(() => document.fonts.ready);
            } catch {
                if (await page.locator('vite-error-overlay').count()) {
                    const message = (await page.locator('vite-error-overlay').evaluate((el) => el.shadowRoot?.querySelector('.message')?.textContent ?? '')).trim();
                    throw new Error(`the playground failed to build (${message.split('\n')[0]}) — run \`pnpm install && pnpm build\` in ${zero}`);
                }
                console.warn(`  ${scope}: the ${ds} stylesheet never committed — shooting anyway`);
            }
            await page.waitForTimeout(400);
            const dir = join(runDir, scope);
            mkdirSync(dir, { recursive: true });
            const file = join(dir, 'web.png');
            // Just the page's demos: at phone width the sidebar and toolbar
            // stack above them and would bury the reference.
            const article = page.locator('main article').first();
            const main = page.locator('main').first();
            if (await article.count()) await article.screenshot({ path: file });
            else if (await main.count()) await main.screenshot({ path: file });
            else await page.screenshot({ path: file, fullPage: true });
            run.web.push({ scope, file: relative(runDir, file).split('\\').join('/'), url, ds, colorScheme });
            console.log(`  ${scope} → ${relative(REPO, file)}`);
        }
    } finally {
        await browser.close();
        if (server) stopServer(server);
    }
    writeFileSync(manifestPath, JSON.stringify(run, null, 2));
    console.log(`web reference → ${relative(REPO, runDir)} (sheet: node scripts/zero-qa/sheet.mjs ${relative(REPO, runDir)})`);
    return 0;
}

try {
    process.exitCode = await main();
} catch (err) {
    console.error(`web-ref: ${err.message}`);
    process.exitCode = 1;
}
