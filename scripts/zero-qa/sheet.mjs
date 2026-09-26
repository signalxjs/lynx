#!/usr/bin/env node
/**
 * sheet — one self-contained HTML contact sheet for a zero-qa run (#1141).
 *
 *   node scripts/zero-qa/sheet.mjs <run-dir> [--out <file.html>] [--link]
 *
 * Reads `<run-dir>/run.json` (written by shoot.mjs / web-ref.mjs) and emits
 * `<run-dir>/index.html`: one group per scope, each section's full shot next
 * to its zoomed crops, and — when web-ref.mjs captured the web daisy page
 * for the scope — that reference at the head of the group. Images are INLINED as data URIs by
 * default so the file can be attached or published on its own; `--link`
 * references them relatively instead (smaller, but only valid inside the
 * run directory).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function arg(name) {
    const i = process.argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const value = process.argv[i + 1];
    return value === undefined || value.startsWith('--') ? true : value;
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function buildSheet(runDir, { link = false } = {}) {
    const manifestPath = join(runDir, 'run.json');
    if (!existsSync(manifestPath)) throw new Error(`no run.json in ${runDir} — run shoot.mjs first`);
    const run = JSON.parse(readFileSync(manifestPath, 'utf8'));

    const src = (file) => {
        const abs = join(runDir, file);
        if (!existsSync(abs)) return null;
        if (link) return escape(relative(runDir, abs).split('\\').join('/'));
        return `data:image/png;base64,${readFileSync(abs).toString('base64')}`;
    };
    const img = (file, cls, alt) => {
        const s = src(file);
        return s ? `<a href="${link ? s : '#'}" class="${cls}"><img loading="lazy" src="${s}" alt="${escape(alt)}"></a>` : '';
    };

    const byScope = new Map();
    for (const shot of run.shots ?? []) {
        if (!byScope.has(shot.scope)) byScope.set(shot.scope, []);
        byScope.get(shot.scope).push(shot);
    }
    // Web references are per SCOPE (the playground has no lynx sections):
    // one full-page shot shown at the head of the scope's group.
    const webByScope = new Map((run.web ?? []).map((w) => [w.scope, w]));
    for (const w of run.web ?? []) if (!byScope.has(w.scope)) byScope.set(w.scope, []);

    const groups = [...byScope].map(([scope, shots]) => {
        const rows = shots.map((shot) => {
            const crops = (shot.crops ?? []).map((c, i) => img(c, 'crop', `${shot.section} crop ${i + 1}`)).join('');
            const warn = shot.stable === false ? '<span class="warn">not stable — shot at timeout</span>' : '';
            return `
<section class="shot" id="${escape(`${shot.scope}-${shot.section}`)}">
  <h3>${escape(shot.section)} <small>${escape(shot.theme ?? '')} · ${escape(shot.url ?? '')}</small> ${warn}</h3>
  <div class="row">
    <figure class="full">${img(shot.file, 'full', `${shot.scope} ${shot.section}`)}<figcaption>lynx · ${escape(run.platform ?? 'ios')}</figcaption></figure>
    <div class="crops">${crops}</div>
  </div>
</section>`;
        }).join('');
        const web = webByScope.get(scope);
        const webRow = web
            ? `<section class="shot"><h3>web reference <small>${escape(web.url ?? '')}</small></h3><div class="row"><figure class="full web">${img(web.file, 'full', `web ${scope}`)}<figcaption>web · ${escape(web.ds ?? 'daisyui')}</figcaption></figure></div></section>`
            : '';
        return `<details open><summary><h2>${escape(scope)}</h2><span>${shots.length} section${shots.length === 1 ? '' : 's'}${web ? ' + web' : ''}</span></summary>${webRow}${rows}</details>`;
    }).join('\n');

    const toc = [...byScope].map(([scope, shots]) =>
        `<li><b>${escape(scope)}</b> ${shots.map((s) => `<a href="#${escape(`${s.scope}-${s.section}`)}">${escape(s.section)}</a>`).join(' ')}</li>`).join('');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Zero QA sheet</title>
<style>
:root{--bg:#f6f6f7;--fg:#18181b;--muted:#6b7280;--card:#fff;--line:#e4e4e7;--warn:#b45309}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111214;--fg:#ececf0;--muted:#9ca3af;--card:#1b1c20;--line:#2c2e33;--warn:#f59e0b}}
:root[data-theme="dark"]{--bg:#111214;--fg:#ececf0;--muted:#9ca3af;--card:#1b1c20;--line:#2c2e33;--warn:#f59e0b}
*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
header{margin-bottom:16px}h1{font-size:20px;margin:0 0 4px}header p{margin:0;color:var(--muted)}
ul.toc{padding-left:18px;color:var(--muted)}ul.toc a{margin-right:6px}
details{background:var(--card);border:1px solid var(--line);border-radius:10px;margin:12px 0;padding:8px 12px}
summary{display:flex;gap:10px;align-items:baseline;cursor:pointer}summary h2{display:inline;font-size:16px;margin:0}summary span{color:var(--muted)}
.shot{border-top:1px solid var(--line);padding:10px 0}.shot h3{font-size:14px;margin:0 0 8px}.shot small{color:var(--muted);font-weight:normal}
.warn{color:var(--warn);font-size:12px;margin-left:8px}
.row{display:flex;gap:12px;align-items:flex-start;overflow-x:auto}
figure{margin:0}figcaption{font-size:11px;color:var(--muted);text-align:center}
.web img{width:402px;max-width:90vw}
.full img{width:260px;max-width:70vw;border:1px solid var(--line);border-radius:8px;display:block}
.crops{display:flex;flex-direction:column;gap:8px;min-width:0;flex:1}
.crops img{width:100%;max-width:900px;border:1px solid var(--line);border-radius:6px;display:block}
a{color:inherit}
</style></head><body>
<header><h1>Zero QA · ${escape(run.run ?? basename(runDir))}</h1>
<p>${escape(run.platform ?? 'ios')} · ${escape(run.device ?? '')} · ${escape(run.createdAt ?? '')}${run.git ? ` · ${escape(run.git)}` : ''}</p>
<ul class="toc">${toc}</ul></header>
${groups}
</body></html>`;
}

function main() {
    const runDir = process.argv[2];
    if (!runDir || runDir.startsWith('--')) {
        console.error('usage: sheet.mjs <run-dir> [--out <file.html>] [--link]');
        return 2;
    }
    const html = buildSheet(resolve(runDir), { link: !!arg('link') });
    const out = resolve(String(arg('out') ?? join(runDir, 'index.html')));
    writeFileSync(out, html);
    console.log(`contact sheet → ${out} (${Math.round(html.length / 1024)} KB)`);
    return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exitCode = main();
}
