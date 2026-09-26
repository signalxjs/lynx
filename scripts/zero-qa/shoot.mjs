#!/usr/bin/env node
/**
 * shoot — screenshot the zero state-matrix gallery on the iOS simulator,
 * tap-free (#1141, epic #1140).
 *
 *   node scripts/zero-qa/shoot.mjs --scope button,switch/color [--theme dark]
 *        [--dev-url http://localhost:8788/main.lynx.bundle] [--run <name>]
 *        [--bands 3] [--timeout 30] [--platform ios] [--holder <name>]
 *
 * A target is a scope (every section of it, from the gallery registry
 * `examples/showcase/src/screens/zero/gallery/scopes.ts`) or `scope/section`.
 * For each section it cold-launches the showcase straight into
 * `showcase://zero-gallery/<scope>/<section>` (terminate + `simctl openurl`),
 * waits until consecutive screenshots agree (a pixel-diff tolerance, so an
 * indeterminate progress bar or the clock doesn't stall it) AND the page has
 * content (the loading spinner alone is rejected) — never a bare sleep — saves the shot and `--bands` horizontal zoom crops under
 * `.zero-qa/<run>/<scope>/`, and records everything in `.zero-qa/<run>/run.json`
 * for sheet.mjs.
 *
 * The app must be a DEBUG showcase build that includes the deep-link host
 * fix (`.onOpenURL`, #1141) and a running `sigx dev` for the bundle. A cold
 * openurl launch reconnects to the app's LAST dev URL — pass `--dev-url` to
 * (re)seed it first (one `simctl launch --sigx_dev_url` per run).
 *
 * The simulator is a shared resource: shoot takes the sim lock
 * (sim-lock.mjs) for the run when it is free, proceeds when you already
 * hold it (same --holder / SIGX_SIM_HOLDER), and refuses when someone else does.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { acquire, LOCK_DIR, readOwner } from './sim-lock.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const SCOPES_TS = join(REPO, 'examples', 'showcase', 'src', 'screens', 'zero', 'gallery', 'scopes.ts');
const BUNDLE_ID = 'com.example.showcase';

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const value = process.argv[i + 1];
    return value === undefined || value.startsWith('--') ? true : value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function simctl(...args) {
    return execFileSync('xcrun', ['simctl', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Screenshot the booted sim as BMP (raw pixels to diff) — returns the buffer. */
function screenshotBmp(file) {
    simctl('io', 'booted', 'screenshot', '--type=bmp', file);
    return readFileSync(file);
}

/** Fraction of sampled pixel bytes that differ between two same-size BMPs. */
function diffRatio(a, b) {
    if (!a || !b || a.length !== b.length) return 1;
    const offset = a.readUInt32LE(10);
    let differ = 0;
    let total = 0;
    for (let i = offset; i < a.length; i += 37) {
        total++;
        if (Math.abs(a[i] - b[i]) > 8) differ++;
    }
    return total === 0 ? 1 : differ / total;
}

/**
 * Fraction of sampled pixels that differ from the page background (the
 * pixel just below the status bar). The dev client's loading overlay — a
 * small spinner centred on a blank page — is nearly static, so stability
 * alone would accept it. The centre box is excluded, so the overlay scores
 * ~0 while any rendered section (its title row, at least) scores above it.
 */
function contentRatio(bmp) {
    const offset = bmp.readUInt32LE(10);
    const width = bmp.readInt32LE(18);
    const height = Math.abs(bmp.readInt32LE(22));
    const bpp = bmp.readUInt16LE(28) / 8;
    const stride = Math.ceil((width * bpp) / 4) * 4;
    const topDown = bmp.readInt32LE(22) < 0;
    const rowAt = (y) => offset + (topDown ? y : height - 1 - y) * stride;
    const bg = rowAt(Math.round(height * 0.06)) + Math.round(width * 0.02) * bpp;
    let hits = 0;
    let total = 0;
    for (let y = Math.round(height * 0.06); y < height * 0.95; y += 7) {
        const row = rowAt(y);
        const centerRow = y > height * 0.4 && y < height * 0.6;
        for (let x = 0; x < width; x += 7) {
            // The spinner sits dead centre — never count it as content.
            if (centerRow && x > width * 0.4 && x < width * 0.6) continue;
            const p = row + x * bpp;
            total++;
            if (Math.abs(bmp[p] - bmp[bg]) + Math.abs(bmp[p + 1] - bmp[bg + 1]) + Math.abs(bmp[p + 2] - bmp[bg + 2]) > 30) hits++;
        }
    }
    return total === 0 ? 0 : hits / total;
}

/**
 * Wait until the screen settles: two consecutive frames within `tolerance`
 * (default 0.3% of sampled bytes) after a short minimum. Returns
 * { stable, bmp } — on timeout the last frame, flagged unstable.
 */
async function waitStable(tmp, { timeoutMs, minMs = 1200, intervalMs = 600, tolerance = 0.003, minContent = 0.003 }) {
    const start = Date.now();
    await sleep(minMs);
    let prev = screenshotBmp(tmp);
    let calm = 0;
    while (Date.now() - start < timeoutMs) {
        await sleep(intervalMs);
        const next = screenshotBmp(tmp);
        calm = diffRatio(prev, next) <= tolerance && contentRatio(next) >= minContent ? calm + 1 : 0;
        prev = next;
        if (calm >= 2) return { stable: true, bmp: prev };
    }
    return { stable: false, bmp: prev };
}

function sips(...args) {
    execFileSync('sips', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

function imageSize(file) {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
    return {
        width: Number(/pixelWidth: (\d+)/.exec(out)[1]),
        height: Number(/pixelHeight: (\d+)/.exec(out)[1]),
    };
}

/**
 * Horizontal zoom bands over the content (below the status bar, above the
 * home indicator), overlapping a little so no row is cut in every band.
 */
function cropBands(png, outBase, bands) {
    const { width, height } = imageSize(png);
    const top = Math.round(height * 0.055);
    const bottom = Math.round(height * 0.97);
    const span = bottom - top;
    const band = Math.round(span / bands);
    const overlap = Math.round(band * 0.08);
    const files = [];
    for (let i = 0; i < bands; i++) {
        const y = Math.max(top, top + i * band - overlap);
        const h = Math.min(bottom - y, band + 2 * overlap);
        const out = `${outBase}.band${i + 1}.png`;
        sips('-c', String(h), String(width), '--cropOffset', String(y), '0', png, '--out', out);
        files.push(out);
    }
    return files;
}

function stamp() {
    return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function loadRegistry() {
    try {
        return await import(pathToFileURL(SCOPES_TS).href);
    } catch (err) {
        throw new Error(`could not import ${relative(REPO, SCOPES_TS)} (needs Node ≥ 22.18 for type stripping): ${err.message}`);
    }
}

async function main() {
    const platform = String(arg('platform', 'ios'));
    if (platform !== 'ios') {
        console.error(`--platform ${platform}: only ios is implemented (an Android lane would use adb screencap + an am start VIEW intent)`);
        return 2;
    }
    const targetsArg = arg('scope');
    if (!targetsArg || targetsArg === true) {
        console.error('usage: shoot.mjs --scope <scope|scope/section>[,…] [--theme <name>] [--dev-url <url>] [--run <name>] [--bands 3]');
        return 2;
    }
    const { GALLERY_SCOPES, gallerySections } = await loadRegistry();

    const targets = [];
    for (const raw of String(targetsArg).split(',').map((s) => s.trim()).filter(Boolean)) {
        const [scope, section] = raw.split('/');
        if (!Object.prototype.hasOwnProperty.call(GALLERY_SCOPES, scope)) {
            console.error(`unknown scope "${scope}" — have: ${Object.keys(GALLERY_SCOPES).join(', ')}`);
            return 2;
        }
        for (const s of section ? [section] : gallerySections(scope)) targets.push({ scope, section: s });
    }

    const holder = String(arg('holder', process.env.SIGX_SIM_HOLDER ?? `${userInfo().username}@${process.cwd()}`));
    const owner = readOwner();
    let tookLock = false;
    if (!owner) {
        const res = acquire({ holder });
        if (!res.ok) {
            console.error(res.owner
                ? `sim lock is held by "${res.owner.holder}" since ${res.owner.since} — not shooting (${LOCK_DIR})`
                : `sim lock directory exists with no owner record (a crashed acquire?) — not shooting. Inspect ${LOCK_DIR}, then \`sim-lock.mjs release --force\`.`);
            return 1;
        }
        tookLock = true;
    } else if (owner.holder !== holder) {
        console.error(`sim lock is held by "${owner.holder}" since ${owner.since} — not shooting. Pass --holder "${owner.holder}" if that is you.`);
        return 1;
    }

    const theme = arg('theme');
    const bands = Number(arg('bands', 3));
    const timeoutMs = Number(arg('timeout', 30)) * 1000;
    const runName = String(arg('run', stamp()));
    const runDir = join(REPO, '.zero-qa', runName);
    mkdirSync(runDir, { recursive: true });
    const tmp = join(tmpdir(), `zero-qa-${process.pid}.bmp`);

    let device = '';
    try {
        device = /\n\s+(.+?) \([0-9A-F-]{36}\) \(Booted\)/.exec(simctl('list', 'devices', 'booted'))?.[1] ?? '';
    } catch { /* reported below by the first simctl call */ }
    let git = '';
    try {
        git = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
    } catch { /* not a checkout */ }

    const manifestPath = join(runDir, 'run.json');
    let run;
    try {
        run = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
        run = { run: runName, platform, device, git, createdAt: new Date().toISOString(), shots: [] };
    }

    try {
        const devUrl = arg('dev-url');
        if (devUrl && devUrl !== true) {
            // Seed the dev client's remembered URL: an openurl cold launch
            // carries no launch args and reconnects to the last one.
            try { simctl('terminate', 'booted', BUNDLE_ID); } catch { /* not running */ }
            simctl('launch', 'booted', BUNDLE_ID, '--sigx_dev_url', String(devUrl));
            await waitStable(tmp, { timeoutMs });
        }

        for (const { scope, section } of targets) {
            const query = theme && theme !== true ? `?theme=${encodeURIComponent(String(theme))}` : '';
            const url = `showcase://zero-gallery/${scope}/${section}${query}`;
            try { simctl('terminate', 'booted', BUNDLE_ID); } catch { /* not running */ }
            simctl('openurl', 'booted', url);
            const tolerance = GALLERY_SCOPES[scope].settleTolerance ?? 0.003;
            const { stable, bmp } = await waitStable(tmp, { timeoutMs, tolerance });
            const dir = join(runDir, scope);
            mkdirSync(dir, { recursive: true });
            const base = join(dir, theme && theme !== true ? `${section}.${theme}` : section);
            writeFileSync(`${base}.bmp`, bmp);
            sips('-s', 'format', 'png', `${base}.bmp`, '--out', `${base}.png`);
            rmSync(`${base}.bmp`, { force: true });
            const crops = cropBands(`${base}.png`, base, bands);
            const rel = (f) => relative(runDir, f).split('\\').join('/');
            run.shots = run.shots.filter((s) => !(s.scope === scope && s.section === section && s.theme === (theme || undefined)));
            run.shots.push({
                scope,
                section,
                theme: theme && theme !== true ? String(theme) : undefined,
                url,
                file: rel(`${base}.png`),
                crops: crops.map(rel),
                stable,
            });
            writeFileSync(manifestPath, JSON.stringify(run, null, 2));
            console.log(`  ${scope}/${section}${stable ? '' : ' (NOT stable — shot at timeout)'} → ${relative(REPO, `${base}.png`)}`);
        }
    } finally {
        rmSync(tmp, { force: true });
        if (tookLock) rmSync(LOCK_DIR, { recursive: true, force: true });
    }
    console.log(`run → ${relative(REPO, runDir)}  (contact sheet: node scripts/zero-qa/sheet.mjs ${relative(REPO, runDir)})`);
    return 0;
}

process.exitCode = await main();
