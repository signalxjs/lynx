/**
 * `sigx run:web` — build a SignalX app for web and run it in the browser.
 *
 * The web peer of `run:android` / `run:ios`. Builds the web bundle
 * (`rspeedy build --environment web`), then serves three things over one HTTP
 * server with cross-origin-isolation headers:
 *   1. a generated `<lynx-view>` host page (`/`),
 *   2. the upstream `@lynx-js/web-core` browser engine — its prebuilt
 *      `client.prod.js` + wasm, served straight from `node_modules` (`/engine/static/*`),
 *   3. the app's own `dist/` bundle (`/app/*`).
 * web-core needs COOP/COEP cross-origin isolation (SharedArrayBuffer) and
 * `application/wasm` MIME — both set here. localhost is a secure context so
 * isolation works; a plain-http LAN address (`--host`) is not, so SAB-dependent
 * features may degrade there.
 *
 * Live reload: bundler HMR/live-reload are gated off for web (see
 * `lynx-plugin/entry.ts`, matching upstream), so this runs its own loop —
 * `rspeedy build --watch` rewrites the bundle, an fs.watch picks it up, and a
 * WebSocket tells the page to `location.reload()`. (Full reload, not hot-swap.)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readdirSync, statSync, watch } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, normalize, relative } from 'node:path';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';

import { getAllLanIPs } from './network.js';

interface CliLogger {
  log(message: string): void;
  error(message: string): void;
  warn(message: string): void;
}

interface RunWebCtx {
  cwd: string;
  args: Record<string, unknown>;
  logger: CliLogger;
}

const RELOAD_PATH = '/__sigx_reload';
const DEFAULT_PORT = 8900;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bundle': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** First free TCP port at or after `start` (mirrors dev-server's helper). */
function findFreePort(start: number): Promise<number> {
  const check = (port: number): Promise<boolean> =>
    new Promise((resolve) => {
      const srv = createNetServer();
      srv.unref();
      srv.once('error', () => resolve(false));
      srv.listen(port, '0.0.0.0', () => srv.close(() => resolve(true)));
    });
  return (async () => {
    for (let p = start; p < start + 50; p++) {
      // eslint-disable-next-line no-await-in-loop
      if (await check(p)) return p;
    }
    return start;
  })();
}

/** Name of the web bundle in `dist/`, preferring `main.web.bundle`. */
export function findWebBundle(distDir: string): string | null {
  if (!existsSync(distDir)) return null;
  const files = readdirSync(distDir).filter((f) => f.endsWith('.web.bundle'));
  if (files.length === 0) return null;
  return files.includes('main.web.bundle') ? 'main.web.bundle' : files.sort()[0]!;
}

/**
 * Poll `dist/` until a `*.web.bundle` exists and its size is stable across two
 * reads (the build has flushed it). Fails fast if a non-watch build exits
 * non-zero before any bundle appears.
 */
async function waitForBundle(
  distDir: string,
  timeoutMs: number,
  exitCode: () => number | null,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const name = findWebBundle(distDir);
    if (name) {
      const size = statSync(join(distDir, name)).size;
      if (size > 0 && size === lastSize) {
        if (++stable >= 2) return name;
      } else {
        stable = 0;
      }
      lastSize = size;
    }
    const code = exitCode();
    if (code != null && code !== 0 && !name) {
      throw new Error(`rspeedy build exited with code ${code}`);
    }
    // eslint-disable-next-line no-await-in-loop
    await delay(250);
  }
  throw new Error('timed out waiting for the web build');
}

export function contentType(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Join `rel` under `root`, or null if it would escape the root. Uses
 * `path.relative` (not `startsWith`) so a sibling that merely shares the root's
 * name as a string prefix — e.g. `root/../root2/x` — is correctly rejected.
 */
export function safeJoin(root: string, rel: string): string | null {
  const abs = normalize(join(root, rel));
  const within = relative(normalize(root), abs);
  return within.startsWith('..') || isAbsolute(within) ? null : abs;
}

export function hostHtml(projectName: string, bundle: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>${projectName} — SignalX (web)</title>
  <link rel="icon" href="data:," />
  <link rel="stylesheet" href="/engine/static/css/client.css" />
  <script type="module" src="/engine/static/js/client.js"></script>
  <style>
    html, body { margin: 0; height: 100%; background: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "Helvetica Neue", Arial, "Noto Sans", sans-serif; }
    lynx-view { display: block; }
  </style>
</head>
<body>
  <lynx-view style="height:100vh;width:100vw" url="/app/${bundle}" height="100vh" width="100vw"></lynx-view>
  <script type="module">
    // Host-page bridge (#703): sigx.* RPC handlers (clipboard, share, linking,
    // pickers, vibrate) + appearance / initial-URL publishers.
    import { installSigxWebHost } from '/host/sigx-host.js';
    const sigxView = document.querySelector('lynx-view');
    if (!sigxView) {
      throw new Error('[sigx run:web] <lynx-view> element not found — host page markup out of sync');
    }
    installSigxWebHost(sigxView);
  </script>
  <script>
    (function () {
      try {
        var ws = new WebSocket((location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host + '${RELOAD_PATH}');
        ws.onmessage = function () { location.reload(); };
      } catch (e) { /* reload channel unavailable — manual refresh still works */ }
    })();
  </script>
</body>
</html>
`;
}

export async function runWeb(ctx: RunWebCtx): Promise<void> {
  const { cwd, logger } = ctx;
  const watchMode = ctx.args.watch !== false;
  const openBrowserFlag = ctx.args.open !== false;
  const exposeHost = ctx.args.host === true;
  const desiredPort = Number(ctx.args.port) || DEFAULT_PORT;
  const distDir = join(cwd, 'dist');
  const projectName = basename(cwd);

  // Resolve the web-core engine (a CLI dependency) — served read-only from node_modules.
  let engineStaticDir: string;
  let hostJsPath: string;
  try {
    const req = createRequire(import.meta.url);
    const clientJs = req.resolve('@lynx-js/web-core/client.prod.js');
    engineStaticDir = dirname(dirname(clientJs)); // …/client_prod/static/js/client.js → …/static
    hostJsPath = req.resolve('@sigx/lynx-web-host/host');
  } catch {
    logger.error('Could not resolve @lynx-js/web-core / @sigx/lynx-web-host — try reinstalling dependencies.');
    process.exitCode = 1;
    return;
  }

  // Build (watch or one-shot). stdio inherited so the user sees build output.
  // SIGX_WEB_ENV=1 lets `pluginSigxLynx` auto-provide `environments.web` (and
  // `lynx`) when the app's lynx.config.ts declares none (#699) — run:web needs
  // no config edit. User-declared environments are always preserved.
  const buildArgs = ['rspeedy', 'build', '--environment', 'web', ...(watchMode ? ['--watch'] : [])];
  logger.log(`Building the web bundle${watchMode ? ' (watching for changes)' : ''}…`);
  const buildChild: ChildProcess = spawn('npx', buildArgs, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, SIGX_WEB_ENV: '1' },
  });
  let buildExit: number | null = null;
  buildChild.on('exit', (code) => {
    buildExit = code ?? 0;
  });

  let bundleName: string;
  try {
    bundleName = await waitForBundle(distDir, 180_000, () => buildExit);
  } catch (e) {
    logger.error(`No \`*.web.bundle\` was produced: ${String(e)}`);
    logger.error(
      'The web environment is normally auto-provided by pluginSigxLynx. If you passed ' +
        '`web: false` to the plugin (or a custom setup filtered it out), add ' +
        '`environments: { lynx: {}, web: {} }` to your lynx.config.ts, then retry.',
    );
    try {
      buildChild.kill();
    } catch {
      /* already gone */
    }
    process.exitCode = 1;
    return;
  }

  const port = await findFreePort(desiredPort);

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Cross-origin isolation for SharedArrayBuffer + cross-origin engine/wasm.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    let url: string;
    try {
      url = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    } catch {
      // Malformed percent-encoding — answer 400 instead of crashing the server.
      res.writeHead(400).end('Bad request');
      return;
    }

    if (url === '/' || url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(hostHtml(projectName, bundleName));
      return;
    }
    if (url.startsWith('/engine/static/')) {
      const abs = safeJoin(engineStaticDir, url.slice('/engine/static/'.length));
      if (!abs) {
        res.writeHead(403).end();
        return;
      }
      void serveFile(res, abs, 'public, max-age=31536000, immutable');
      return;
    }
    if (url.startsWith('/app/')) {
      const rel = url.slice('/app/'.length);
      const abs = safeJoin(distDir, rel);
      if (!abs) {
        res.writeHead(403).end();
        return;
      }
      // The bundle must never be cached (it's rewritten on every rebuild).
      void serveFile(res, abs, rel.endsWith('.web.bundle') ? 'no-cache' : 'public, max-age=600');
      return;
    }
    if (url === '/host/sigx-host.js') {
      // Self-contained ESM host bridge (#703) — served from the CLI's own
      // @sigx/lynx-web-host dependency, same pattern as the engine assets.
      void serveFile(res, hostJsPath, 'no-cache');
      return;
    }
    res.writeHead(404).end('Not found');
  });

  // WebSocket reload channel.
  const wss = new WebSocketServer({ server, path: RELOAD_PATH });
  const broadcastReload = (): void => {
    for (const client of wss.clients) {
      try {
        client.send('reload');
      } catch {
        /* client gone */
      }
    }
  };

  if (watchMode) {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    watch(distDir, (_event, filename) => {
      if (!filename || !filename.toString().endsWith('.web.bundle')) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        logger.log('↻ rebuilt — reloading the browser');
        broadcastReload();
      }, 200);
    });
  }

  // Bind loopback by default; only expose on all interfaces with --host.
  const bindHost = exposeHost ? '0.0.0.0' : '127.0.0.1';
  await new Promise<void>((resolve) => server.listen(port, bindHost, resolve));

  const localUrl = `http://localhost:${port}/`;
  console.log('\n  \x1b[1m⚡ sigx run:web\x1b[0m\n');
  console.log(`  Local:    ${localUrl}`);
  if (exposeHost) {
    for (const ip of getAllLanIPs()) {
      console.log(`  Network:  http://${ip.address}:${port}/  \x1b[2m(${ip.name})\x1b[0m`);
    }
    console.log('  \x1b[2m(LAN over http is not cross-origin-isolated — some features may degrade)\x1b[0m');
  }
  console.log(`  Bundle:   app/${bundleName}`);
  console.log(`  Reload:   ${watchMode ? 'on — edits rebuild and reload' : 'off (--no-watch)'}`);
  console.log('\n  Press Ctrl+C to stop.\n');

  if (openBrowserFlag) openBrowser(localUrl);

  const shutdown = (): void => {
    try {
      buildChild.kill();
    } catch {
      /* already gone */
    }
    try {
      wss.close();
    } catch {
      /* ignore */
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep the process alive until Ctrl+C.
  await new Promise<void>(() => {});
}

async function serveFile(res: ServerResponse, absPath: string, cacheControl: string): Promise<void> {
  try {
    const buf = await readFile(absPath);
    res.writeHead(200, { 'Content-Type': contentType(absPath), 'Cache-Control': cacheControl });
    res.end(buf);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

function openBrowser(url: string): void {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    /* opening is best-effort */
  }
}
