const fs = require('fs');
const BS = String.fromCharCode(92);
let miss = [];
const edit = (file, pairs) => {
    let src = fs.readFileSync(file, 'utf8').split('\r\n').join('\n');
    for (const [from, to, tag] of pairs) {
        if (!src.includes(from)) { miss.push(tag); continue; }
        src = src.split(from).join(to);
    }
    fs.writeFileSync(file, src);
    return src;
};

// 1) target-picker: repair the ANSI-strip regex (lost its \x1b escape).
edit('packages/lynx-cli/src/target-picker.ts', [
    ["const stripAnsiCodes = (s: string): string => s.replace(/[[0-9;]*m/g, '');",
     "const stripAnsiCodes = (s: string): string => s.replace(/" + BS + "x1b" + BS + "[[0-9;]*m/g, '');",
     'strip-regex'],
]);

// 2+3) build-output: drop trailing \n inside out(`...`) templates — the
// default emitter adds the newline itself.
let src = fs.readFileSync('packages/lynx-cli/src/build-output.ts', 'utf8').split('\r\n').join('\n');
const before = src;
// out(`...\n`, 'stdout')  →  out(`...`, 'stdout')
src = src.replace(/out\((`(?:[^`]|`(?:[^`]*)`)*?)\\n`(, '(?:stdout|stderr)'\))/g, 'out($1`$2');
if (src === before) miss.push('template-newlines');

// 4) runVerbose: line-buffer chunks before the sink (chunk boundaries are
// arbitrary; sinks assume one call == one line).
const verboseOld = `    if (opts.sink) {
        const piped = spawn(cmd, args, { ...spawnOpts, stdio: ['inherit', 'pipe', 'pipe'] });
        piped.stdout?.on('data', (c: Buffer) => opts.sink!(c.toString()));
        piped.stderr?.on('data', (c: Buffer) => opts.sink!(c.toString()));
        return awaitExit(piped);
    }`;
const verboseNew = `    if (opts.sink) {
        const piped = spawn(cmd, args, { ...spawnOpts, stdio: ['inherit', 'pipe', 'pipe'] });
        // Line-buffer: chunk boundaries are arbitrary, and sinks treat one
        // call as one line.
        let buf = '';
        const feed = (c: Buffer) => {
            buf += c.toString();
            const idx = buf.lastIndexOf('${BS}n');
            if (idx === -1) return;
            for (const line of buf.slice(0, idx).split('${BS}n')) opts.sink!(line);
            buf = buf.slice(idx + 1);
        };
        piped.stdout?.on('data', feed);
        piped.stderr?.on('data', feed);
        return awaitExit(piped).finally(() => { if (buf) opts.sink!(buf); });
    }`;
if (!src.includes(verboseOld)) miss.push('verbose-buffer');
else src = src.split(verboseOld).join(verboseNew);

// The onChunk-verbose path forwards raw chunks to the sink — same mid-line
// problem. Give both handlers a shared line buffer.
const onChunkBlockOld = `    if (opts.onChunk) {
        const child = spawn(cmd, args, { ...spawnOpts, stdio: ['inherit', 'pipe', 'pipe'] });
        child.stdout?.on('data', (chunk: Buffer) => {
            opts.onChunk!(chunk, 'stdout');
            if (opts.sink) opts.sink(chunk.toString());
            else process.stdout.write(chunk);
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            opts.onChunk!(chunk, 'stderr');
            if (opts.sink) opts.sink(chunk.toString());
            else process.stderr.write(chunk);
        });
        return awaitExit(child);
    }`;
const onChunkBlockNew = `    if (opts.onChunk) {
        const child = spawn(cmd, args, { ...spawnOpts, stdio: ['inherit', 'pipe', 'pipe'] });
        // Sinks treat one call as one line — buffer arbitrary chunk
        // boundaries (onChunk listeners keep getting the raw chunks).
        let chunkBuf = '';
        const sinkFeed = (c: Buffer) => {
            chunkBuf += c.toString();
            const idx = chunkBuf.lastIndexOf('${BS}n');
            if (idx === -1) return;
            for (const line of chunkBuf.slice(0, idx).split('${BS}n')) opts.sink!(line);
            chunkBuf = chunkBuf.slice(idx + 1);
        };
        child.stdout?.on('data', (chunk: Buffer) => {
            opts.onChunk!(chunk, 'stdout');
            if (opts.sink) sinkFeed(chunk);
            else process.stdout.write(chunk);
        });
        child.stderr?.on('data', (chunk: Buffer) => {
            opts.onChunk!(chunk, 'stderr');
            if (opts.sink) sinkFeed(chunk);
            else process.stderr.write(chunk);
        });
        return awaitExit(child).finally(() => { if (chunkBuf && opts.sink) opts.sink(chunkBuf); });
    }`;
if (!src.includes(onChunkBlockOld)) miss.push('onchunk-buffer');
else src = src.split(onChunkBlockOld).join(onChunkBlockNew);

fs.writeFileSync('packages/lynx-cli/src/build-output.ts', src);

if (miss.length) { console.error('MISSED:', miss); process.exit(1); }
console.log('review fixes applied');
