/**
 * `sigx build:web` — deployable static export of the web app (#714).
 *
 * Runs the web build, then emits a self-contained `dist/web/` any static host
 * can serve:
 *
 *   index.html         host page (no reload client; #703 bridge inlined ref)
 *   engine/static/**   upstream @lynx-js/web-core prebuilt engine
 *   app/**             the app bundle + its static assets (async chunks)
 *   host/sigx-host.js  @sigx/lynx-web-host page bridge
 *   coi.js             (--coi) COI service-worker shim for header-less hosts
 *   _headers,vercel.json  header samples — COOP/COEP are a serving concern
 *
 * web-core needs cross-origin isolation (SharedArrayBuffer): COOP
 * `same-origin` + COEP `require-corp`. Hosts that can set headers should
 * (samples emitted); GitHub Pages and other header-less hosts can use
 * `--coi`, which registers a service worker that injects the headers
 * client-side (one automatic reload on first visit).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { findWebBundle, hostHtml, resolveWebAssets } from './web-server.js';

interface CliLogger {
  log(message: string): void;
  error(message: string): void;
  warn(message: string): void;
}

interface BuildWebCtx {
  cwd: string;
  args: Record<string, unknown>;
  logger: CliLogger;
}

const HEADERS_SAMPLE = `# Cross-origin isolation — required by @lynx-js/web-core (SharedArrayBuffer).
# Netlify / Cloudflare Pages pick this file up automatically.
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: cross-origin
`;

const VERCEL_SAMPLE = `{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Resource-Policy", "value": "cross-origin" }
      ]
    }
  ]
}
`;

/**
 * Minimal COI service worker + registration shim (one file, `--coi`).
 * Registration path: if the page isn't cross-origin isolated, register this
 * same file as a service worker and reload once; as a worker it injects the
 * COOP/COEP headers into every same-scope response. (Same approach as the
 * well-known coi-serviceworker shim, implemented independently.)
 */
const COI_JS = `/* sigx build:web --coi: client-side cross-origin isolation. */
if (typeof window !== 'undefined') {
  (function () {
    if (window.crossOriginIsolated || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register(document.currentScript.src).then(function (reg) {
      if (reg.active && !navigator.serviceWorker.controller) return;
      var reload = function () { window.location.reload(); };
      if (reg.active) reload();
      else reg.addEventListener('updatefound', function () {
        var sw = reg.installing;
        sw && sw.addEventListener('statechange', function () {
          if (sw.state === 'activated') reload();
        });
      });
    }).catch(function () { /* isolation unavailable — engine may degrade */ });
  })();
} else {
  self.addEventListener('install', function () { self.skipWaiting(); });
  self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
  self.addEventListener('fetch', function (e) {
    var req = e.request;
    if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
    e.respondWith(fetch(req).then(function (res) {
      if (res.status === 0) return res;
      var headers = new Headers(res.headers);
      headers.set('Cross-Origin-Opener-Policy', 'same-origin');
      headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
      headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: headers });
    }));
  });
}
`;

export async function buildWeb(ctx: BuildWebCtx): Promise<void> {
  const { cwd, logger } = ctx;
  const outArg = typeof ctx.args.out === 'string' && ctx.args.out ? ctx.args.out : join('dist', 'web');
  const outDir = join(cwd, outArg);
  const rawBase = typeof ctx.args.base === 'string' && ctx.args.base ? ctx.args.base : '/';
  const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
  const coi = ctx.args.coi === true;
  const distDir = join(cwd, 'dist');
  const projectName = basename(cwd);

  let assets: { engineStaticDir: string; hostJsPath: string };
  try {
    assets = resolveWebAssets();
  } catch {
    logger.error('Could not resolve @lynx-js/web-core / @sigx/lynx-web-host — try reinstalling dependencies.');
    process.exitCode = 1;
    return;
  }

  // One-shot web build (same env contract as run:web — #699 zero-config).
  logger.log('Building the web bundle…');
  const child: ChildProcess = spawn('npx', ['rspeedy', 'build', '--environment', 'web'], {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, SIGX_WEB_ENV: '1' },
  });
  // One-shot build: wait for the CHILD to exit, not for a bundle to appear —
  // a stale bundle from a previous build looks "stable" while rspeedy's clean
  // phase is about to wipe dist/ (which would also wipe a too-early export).
  const buildExit: number = await new Promise((resolve) =>
    child.on('exit', (code) => resolve(code ?? 0)),
  );
  if (buildExit !== 0) {
    logger.error(`rspeedy build exited with code ${buildExit}`);
    process.exitCode = 1;
    return;
  }
  const bundleName = findWebBundle(distDir);
  if (!bundleName) {
    logger.error('The build produced no `*.web.bundle` in dist/.');
    process.exitCode = 1;
    return;
  }

  // Assemble the export.
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'app'), { recursive: true });
  mkdirSync(join(outDir, 'host'), { recursive: true });

  // App bundle + its static assets (async chunks under static/) — everything
  // in dist/ except native bundles and a previous export at the same path.
  for (const entry of readdirSync(distDir)) {
    if (entry.endsWith('.lynx.bundle')) continue;
    const abs = join(distDir, entry);
    if (abs === outDir) continue;
    cpSync(abs, join(outDir, 'app', entry), { recursive: true });
  }
  cpSync(assets.engineStaticDir, join(outDir, 'engine', 'static'), { recursive: true });
  cpSync(assets.hostJsPath, join(outDir, 'host', 'sigx-host.js'));
  writeFileSync(
    join(outDir, 'index.html'),
    hostHtml(projectName, bundleName, { reload: false, base, coi }),
  );
  writeFileSync(join(outDir, '_headers'), HEADERS_SAMPLE);
  writeFileSync(join(outDir, 'vercel.json'), VERCEL_SAMPLE);
  if (coi) writeFileSync(join(outDir, 'coi.js'), COI_JS);

  logger.log('');
  logger.log(`Static web export ready: ${outDir}`);
  logger.log(`  bundle: app/${bundleName}   base: ${base}${coi ? '   coi: on' : ''}`);
  logger.log('');
  logger.log('Serving requirements (cross-origin isolation for SharedArrayBuffer):');
  logger.log('  Cross-Origin-Opener-Policy: same-origin');
  logger.log('  Cross-Origin-Embedder-Policy: require-corp');
  if (coi) {
    logger.log('  (--coi: a service worker injects these client-side for header-less');
    logger.log('   hosts like GitHub Pages — expect one automatic reload on first visit.)');
  } else {
    logger.log('  Samples emitted: _headers (Netlify/Cloudflare) and vercel.json.');
    logger.log('  Header-less host (e.g. GitHub Pages)? Re-run with --coi.');
  }
}

/** Exported for tests: the files every export must contain. */
export function expectedExportManifest(bundleName: string, coi: boolean): string[] {
  const base = [
    'index.html',
    '_headers',
    'vercel.json',
    join('app', bundleName),
    join('host', 'sigx-host.js'),
    join('engine', 'static', 'js', 'client.js'),
    join('engine', 'static', 'css', 'client.css'),
  ];
  return coi ? [...base, 'coi.js'] : base;
}

/** Exported for tests: verify an export directory is complete. */
export function verifyExport(outDir: string, bundleName: string, coi: boolean): string[] {
  return expectedExportManifest(bundleName, coi).filter((rel) => !existsSync(join(outDir, rel)));
}
