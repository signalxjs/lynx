// Generates the bundled placeholder PNGs in templates/defaults/.
// Run via: pnpm --filter @sigx/lynx-cli exec node scripts/gen-defaults.mjs
//
// These are checked in as binary so end users don't need sharp at install time
// to get a working first prebuild. Re-run this only when the placeholder design
// changes.
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'templates', 'defaults');
mkdirSync(outDir, { recursive: true });

const TEAL = '#0D9488';
const WHITE = '#FFFFFF';

// "S" mark — geometric sigx-style monogram, white on whatever bg
function markSvg(size, fill, includeBg, bgColor) {
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.32;
    const stroke = size * 0.13;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        ${includeBg ? `<rect width="${size}" height="${size}" rx="${size * 0.22}" ry="${size * 0.22}" fill="${bgColor}"/>` : ''}
        <path d="
            M ${cx + r} ${cy - r}
            a ${r} ${r} 0 1 0 -${r} ${r}
            l 0 0
            a ${r} ${r} 0 1 1 -${r} ${r}
        "
        fill="none" stroke="${fill}" stroke-width="${stroke}" stroke-linecap="round"/>
    </svg>`;
}

async function generate(name, svg, size) {
    const buf = Buffer.from(svg);
    const png = await sharp(buf, { density: 300 }).resize(size, size).png().toBuffer();
    const path = join(outDir, name);
    writeFileSync(path, png);
    console.log(`  wrote ${path} (${png.length} bytes)`);
}

console.log('Generating sigx-lynx default placeholder assets...');

// icon.png — 1024×1024 with rounded teal background + white S
await generate('icon.png', markSvg(1024, WHITE, true, TEAL), 1024);

// splash.png — 256×256 transparent bg, teal mark (will sit on user splash bg)
await generate('splash.png', markSvg(256, TEAL, false, null), 256);

// adaptive-foreground.png — 1024×1024 transparent, mark in inner ~66% safe zone
// (safe zone is roughly 660×660 centered; render at scaled-down geometry)
const adaptiveSize = 1024;
const adaptiveSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${adaptiveSize}" height="${adaptiveSize}" viewBox="0 0 ${adaptiveSize} ${adaptiveSize}">
    <g transform="translate(${adaptiveSize * 0.17}, ${adaptiveSize * 0.17}) scale(0.66)">
        ${markSvg(adaptiveSize, WHITE, false, null).replace(/<svg[^>]*>|<\/svg>/g, '')}
    </g>
</svg>`;
await generate('adaptive-foreground.png', adaptiveSvg, adaptiveSize);

console.log('Done.');
