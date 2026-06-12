/**
 * Pretty-print xcodebuild and gradle output.
 *
 * `xcodebuild` and `gradlew` both dump tens of thousands of lines for a
 * cold build — full clang invocations on iOS, NDK/CMake/ninja chatter on
 * Android. Users assume the build hangs because every line looks the same.
 *
 * `runWithBuildFilter` wraps a child process spawn and pipes its output
 * through a kind-specific filter:
 *
 * - iOS: if `xcbeautify` is on PATH, pipe through it; otherwise use a
 *   built-in filter that drops clang flag walls, keeps top-level action
 *   lines (`CompileC`, `Ld`, `CodeSign`, `** BUILD …`), and surfaces
 *   warnings + errors.
 * - Android: built-in gradle filter that summarises `> Task` lines,
 *   collapses UP-TO-DATE/NO-SOURCE tasks into a tail counter, and keeps
 *   ninja CXX progress + errors.
 *
 * Verbose mode (`--verbose` / `SIGX_VERBOSE=1` / `SIGX_VERBOSE_XCODEBUILD=1`)
 * bypasses the filter entirely and inherits stdio like before.
 *
 * Zero new npm dependencies — only `node:child_process` and Node stdlib.
 */

import { spawn, type SpawnOptions, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Logger } from '@sigx/cli/plugin';

export type BuildKind = 'xcodebuild' | 'gradle';

export interface RunWithBuildFilterOptions {
    kind: BuildKind;
    verbose: boolean;
    logger: Logger;
    /**
     * Called once per raw chunk from stdout/stderr BEFORE filtering, so
     * callers (e.g. android-run.ts's signature-mismatch detector) can
     * sniff the unmodified stream regardless of verbose mode.
     */
    onChunk?: (chunk: Buffer, source: 'stdout' | 'stderr') => void;
    /**
     * Where emitted lines go. Default: process stdout/stderr. Set when a
     * live TUI region is mounted (writing around it corrupts frames) — e.g.
     * the dev shell routes builds into its log store.
     */
    sink?: (line: string) => void;
}

const XCBEAUTIFY_CANDIDATES = [
    '/opt/homebrew/bin/xcbeautify',
    '/usr/local/bin/xcbeautify',
    '/usr/bin/xcbeautify',
];

let xcbeautifyHintShown = false;

function detectXcbeautify(): string | null {
    for (const p of XCBEAUTIFY_CANDIDATES) {
        if (existsSync(p)) return p;
    }
    const pathDirs = (process.env.PATH ?? '').split(':');
    for (const dir of pathDirs) {
        if (!dir) continue;
        const candidate = `${dir}/xcbeautify`;
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

/**
 * Run a build command and filter its stdout/stderr unless `verbose` is set.
 * Resolves on exit code 0; rejects with a generic Error on non-zero so
 * the caller can decorate with a domain-specific message.
 */
export async function runWithBuildFilter(
    cmd: string,
    args: string[],
    spawnOpts: SpawnOptions,
    opts: RunWithBuildFilterOptions,
): Promise<void> {
    if (opts.verbose) {
        return runVerbose(cmd, args, spawnOpts, opts);
    }
    if (opts.kind === 'xcodebuild' && !opts.sink) {
        const xcbeautify = detectXcbeautify();
        if (xcbeautify) {
            return runThroughXcbeautify(cmd, args, spawnOpts, xcbeautify, opts);
        }
        if (!xcbeautifyHintShown) {
            xcbeautifyHintShown = true;
            opts.logger.log('\x1b[2mTip: install xcbeautify for nicer build output — brew install xcbeautify\x1b[0m');
        }
    }
    return runWithStreamingFilter(cmd, args, spawnOpts, opts);
}

function runVerbose(
    cmd: string,
    args: string[],
    spawnOpts: SpawnOptions,
    opts: RunWithBuildFilterOptions,
): Promise<void> {
    // Verbose still needs onChunk to fire (signature-mismatch detection).
    if (opts.onChunk) {
        const child = spawn(cmd, args, { ...spawnOpts, stdio: ['inherit', 'pipe', 'pipe'] });
        // Sinks treat one call as one line — buffer arbitrary chunk
        // boundaries (onChunk listeners keep getting the raw chunks).
        let chunkBuf = '';
        const sinkFeed = (c: Buffer) => {
            chunkBuf += c.toString();
            const idx = chunkBuf.lastIndexOf('\n');
            if (idx === -1) return;
            for (const line of chunkBuf.slice(0, idx).split('\n')) opts.sink!(line);
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
    }
    if (opts.sink) {
        const piped = spawn(cmd, args, { ...spawnOpts, stdio: ['inherit', 'pipe', 'pipe'] });
        // Line-buffer: chunk boundaries are arbitrary, and sinks treat one
        // call as one line.
        let buf = '';
        const feed = (c: Buffer) => {
            buf += c.toString();
            const idx = buf.lastIndexOf('\n');
            if (idx === -1) return;
            for (const line of buf.slice(0, idx).split('\n')) opts.sink!(line);
            buf = buf.slice(idx + 1);
        };
        piped.stdout?.on('data', feed);
        piped.stderr?.on('data', feed);
        return awaitExit(piped).finally(() => { if (buf) opts.sink!(buf); });
    }
    const child = spawn(cmd, args, { ...spawnOpts, stdio: 'inherit' });
    return awaitExit(child);
}

function sinkEmit(opts: RunWithBuildFilterOptions): ((line: string, source: 'stdout' | 'stderr') => void) | undefined {
    return opts.sink ? (line) => opts.sink!(line) : undefined;
}

function runWithStreamingFilter(
    cmd: string,
    args: string[],
    spawnOpts: SpawnOptions,
    opts: RunWithBuildFilterOptions,
): Promise<void> {
    const child = spawn(cmd, args, { ...spawnOpts, stdio: ['inherit', 'pipe', 'pipe'] });
    const filter = opts.kind === 'xcodebuild' ? createXcodebuildFilter(sinkEmit(opts)) : createGradleFilter(sinkEmit(opts));

    const wire = (stream: NodeJS.ReadableStream | null, source: 'stdout' | 'stderr') => {
        if (!stream) return;
        stream.on('data', (chunk: Buffer) => {
            opts.onChunk?.(chunk, source);
            filter.feed(chunk, source);
        });
    };
    wire(child.stdout, 'stdout');
    wire(child.stderr, 'stderr');

    return awaitExit(child).finally(() => filter.flush());
}

function runThroughXcbeautify(
    cmd: string,
    args: string[],
    spawnOpts: SpawnOptions,
    xcbeautifyPath: string,
    opts: RunWithBuildFilterOptions,
): Promise<void> {
    const build = spawn(cmd, args, { ...spawnOpts, stdio: ['inherit', 'pipe', 'pipe'] });
    const beautify = spawn(xcbeautifyPath, ['--renderer', 'terminal'], {
        stdio: ['pipe', 'inherit', 'inherit'],
    });

    build.stdout?.on('data', (chunk: Buffer) => {
        opts.onChunk?.(chunk, 'stdout');
        beautify.stdin?.write(chunk);
    });
    build.stderr?.on('data', (chunk: Buffer) => {
        opts.onChunk?.(chunk, 'stderr');
        // xcbeautify reads from stdin only; route stderr straight to terminal.
        process.stderr.write(chunk);
    });
    build.on('close', () => {
        beautify.stdin?.end();
    });

    return awaitExit(build);
}

function awaitExit(child: ChildProcess): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Process exited with code ${code ?? 'null'}`));
        });
        child.on('error', reject);
    });
}

// ---------------------------------------------------------------------------
// Line-buffered filters

interface StreamFilter {
    feed(chunk: Buffer, source: 'stdout' | 'stderr'): void;
    flush(): void;
}

function makeLineSplitter(onLine: (line: string, source: 'stdout' | 'stderr') => void): StreamFilter {
    const buffers: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };
    return {
        feed(chunk, source) {
            const data = buffers[source] + chunk.toString('utf-8');
            const lines = data.split('\n');
            buffers[source] = lines.pop() ?? '';
            for (const line of lines) onLine(line, source);
        },
        flush() {
            for (const source of ['stdout', 'stderr'] as const) {
                const remaining = buffers[source];
                if (remaining) {
                    onLine(remaining, source);
                    buffers[source] = '';
                }
            }
        },
    };
}

// ---- xcodebuild filter ---------------------------------------------------

const XC_ACTION_RE = /^(CompileC|SwiftCompile|SwiftCompileTask|SwiftDriver|SwiftDriverJobDiscovery|SwiftMergeGeneratedHeaders|MergeSwiftModule|EmitSwiftModule|Ld|CodeSign|ProcessInfoPlistFile|CpResource|CpHeader|CreateBuildDirectory|Touch|GenerateDSYMFile|RegisterExecutionPolicyException|ProcessProductPackaging|CopySwiftLibs|Libtool|CompileAssetCatalog|CompileStoryboard|LinkStoryboards|ProcessPCH\+\+?|PhaseScriptExecution)\b/;
const XC_TARGET_RE = /\(in target '([^']+)'/;
const XC_COMPILEC_RE = /^CompileC\s+\S+\s+(\S+)\s+normal/;
const XC_SKIP_PREFIXES = [
    'cd /',
    'export ',
    'builtin-',
    'WriteAuxiliaryFile',
    'Using response file:',
    'Build settings from command line:',
    'User defaults from command line:',
    'Resolved source packages:',
    '--- xcodebuild:',
    'Command line invocation:',
    'note:',
    'Prepare packages',
    'ComputePackagePrebuildTargetDependencyGraph',
    'ComputeTargetDependencyGraph',
    'GatherProvisioningInputs',
    'CreateBuildRequest',
];
const XC_ALWAYS_PRINT_RE = /(\berror:|\*\* (BUILD|ARCHIVE|CLEAN|TEST) (SUCCEEDED|FAILED) \*\*|^ld: |Undefined symbol|Linker command failed|fatal error:|SwiftCompiler Error|❌)/;
const XC_WARNING_RE = /\bwarning:/;

function createXcodebuildFilter(emit?: (line: string, source: 'stdout' | 'stderr') => void): StreamFilter {
    const out = emit ?? ((line, source) => {
        (source === 'stderr' ? process.stderr : process.stdout).write(line + '\n');
    });
    let compileCount = 0;
    let warningCount = 0;
    const WARNING_LIMIT = 20;
    let warningCapReached = false;

    const handleLine = (raw: string, source: 'stdout' | 'stderr') => {
        // Strip trailing CR from CRLF lines.
        const line = raw.replace(/\r$/, '');
        if (line.length === 0) return;

        // Errors and build banners — always print, untouched.
        if (XC_ALWAYS_PRINT_RE.test(line)) {
            out(line, source);
            return;
        }

        // Warnings — rate limit.
        if (XC_WARNING_RE.test(line)) {
            warningCount++;
            if (warningCount <= WARNING_LIMIT) {
                out(line, 'stdout');
            } else if (!warningCapReached) {
                warningCapReached = true;
                out(`\x1b[2m… more warnings suppressed; re-run with --verbose to see them\x1b[0m`, 'stdout');
            }
            return;
        }

        // Top-level action lines.
        if (XC_ACTION_RE.test(line)) {
            const targetMatch = line.match(XC_TARGET_RE);
            const target = targetMatch?.[1];

            if (line.startsWith('CompileC')) {
                const srcMatch = line.match(XC_COMPILEC_RE);
                const src = srcMatch?.[1];
                const file = src ? src.split('/').pop() : undefined;
                compileCount++;
                const label = target && file
                    ? `${target}/${file}`
                    : (file ?? target ?? 'object');
                out(`\x1b[2m▸\x1b[0m Compiling [${compileCount}] ${label}`, 'stdout');
                return;
            }
            if (line.startsWith('SwiftCompile') || line.startsWith('SwiftDriverJobDiscovery')) {
                if (!target) return; // Sub-step noise.
                compileCount++;
                out(`\x1b[2m▸\x1b[0m Compiling Swift [${compileCount}] ${target}`, 'stdout');
                return;
            }
            if (line.startsWith('Ld ')) {
                out(`\x1b[2m▸\x1b[0m Linking ${target ?? ''}`, 'stdout');
                return;
            }
            if (line.startsWith('CodeSign')) {
                out(`\x1b[2m▸\x1b[0m Signing ${target ?? ''}`, 'stdout');
                return;
            }
            if (line.startsWith('PhaseScriptExecution')) {
                const phaseMatch = line.match(/^PhaseScriptExecution\s+([^\s]+(?:\s+[^\s]+)*?)\s+\//);
                out(`\x1b[2m▸\x1b[0m Script ${phaseMatch?.[1] ?? ''} ${target ? `(${target})` : ''}`, 'stdout');
                return;
            }
            // Catch-all: verb + target.
            const verb = line.split(/\s/, 1)[0];
            out(`\x1b[2m▸\x1b[0m ${verb} ${target ?? ''}`, 'stdout');
            return;
        }

        // Drop continuation lines (indented) and known noise prefixes.
        if (/^\s/.test(line)) return;
        if (line.startsWith('/Applications/Xcode.app/')) return;
        if (line.startsWith('/Applications/Xcode-beta.app/')) return;
        if (line.startsWith('clang ') || line.startsWith('clang++ ')) return;
        if (line.startsWith('swift-frontend ') || line.startsWith('swiftc ')) return;
        if (line.startsWith('ProcessPCH')) return;
        for (const p of XC_SKIP_PREFIXES) {
            if (line.startsWith(p)) return;
        }
        // Anything else: drop silently (default-suppress). Errors/build banners
        // are already handled above.
    };

    const splitter = makeLineSplitter(handleLine);
    return {
        feed: splitter.feed,
        flush: () => {
            splitter.flush();
            if (compileCount > 0) {
                out(`\x1b[2m▸ ${compileCount} files compiled\x1b[0m`, 'stdout');
            }
        },
    };
}

// ---- gradle filter -------------------------------------------------------

const GRADLE_TASK_RE = /^> Task (\S+)(?:\s+(UP-TO-DATE|NO-SOURCE|FROM-CACHE|SKIPPED))?\s*$/;
const GRADLE_NINJA_CXX_RE = /^\[(\d+)\/(\d+)\]\s+Building\s+CXX\s+object\s+\S*?([^\/\\]+\.(?:cpp|cc|cxx|c|m|mm))\.o$/;
const GRADLE_NINJA_LINK_RE = /^\[(\d+)\/(\d+)\]\s+Linking\s+.*?(\S+)\s*$/;
const GRADLE_ALWAYS_PRINT_RE = /(^FAILURE:|^\* What went wrong:|^\* Try:|^\* Where:|^BUILD SUCCESSFUL|^BUILD FAILED|^Execution failed|^A problem occurred|^FAILED:|^ninja: error:|^\s*\^|: error:|: fatal error:)/;
const GRADLE_PROGRESS_BAR_RE = /^<[-=]+>\s+\d+%/;

function createGradleFilter(emit?: (line: string, source: 'stdout' | 'stderr') => void): StreamFilter {
    const out = emit ?? ((line, source) => {
        (source === 'stderr' ? process.stderr : process.stdout).write(line + '\n');
    });
    let skippedTaskCount = 0;
    let lastTaskHeader: string | null = null;
    const seenWarnings = new Set<string>();
    let printingFailureBlock = false;

    const handleLine = (raw: string, source: 'stdout' | 'stderr') => {
        const line = raw.replace(/\r$/, '');
        if (line.length === 0) {
            if (printingFailureBlock) out('', 'stdout');
            return;
        }

        // Drop CR-overwriting progress bars.
        if (GRADLE_PROGRESS_BAR_RE.test(line)) return;
        if (line === '> IDLE' || line.startsWith('> IDLE ')) return;

        // Always-print band.
        if (GRADLE_ALWAYS_PRINT_RE.test(line)) {
            out(line, source);
            if (line.startsWith('FAILURE:') || line.startsWith('* What went wrong:')) {
                printingFailureBlock = true;
            }
            if (line.startsWith('BUILD SUCCESSFUL') || line.startsWith('BUILD FAILED')) {
                printingFailureBlock = false;
            }
            return;
        }

        // Once we're in the FAILURE/What-went-wrong block, pass everything
        // through verbatim until we see BUILD SUCCESSFUL/FAILED or a blank
        // run terminates it.
        if (printingFailureBlock) {
            out(line, 'stdout');
            return;
        }

        // `> Task :path:name [STATE]`
        const taskMatch = line.match(GRADLE_TASK_RE);
        if (taskMatch) {
            const [, path, state] = taskMatch;
            if (state) {
                skippedTaskCount++;
                return;
            }
            // Show last segment of the task path; e.g. :app:compileDebugKotlin → compileDebugKotlin.
            const name = path.split(':').filter(Boolean).pop() ?? path;
            // Dedupe repeated task headers (gradle re-prints them when a task has multiple
            // log lines split by other output).
            if (lastTaskHeader === name) return;
            lastTaskHeader = name;
            out(`\x1b[2m▸\x1b[0m ${name}`, 'stdout');
            return;
        }

        // Ninja CXX progress within :externalNativeBuild* / :buildCMake*.
        const ninjaCxx = line.match(GRADLE_NINJA_CXX_RE);
        if (ninjaCxx) {
            const [, n, total, file] = ninjaCxx;
            out(`  \x1b[2m▸\x1b[0m Compiling [${n}/${total}] ${file}`, 'stdout');
            return;
        }
        const ninjaLink = line.match(GRADLE_NINJA_LINK_RE);
        if (ninjaLink) {
            const [, n, total, target] = ninjaLink;
            out(`  \x1b[2m▸\x1b[0m Linking [${n}/${total}] ${target}`, 'stdout');
            return;
        }

        // Deprecation/incubating warnings — dedupe.
        if (/deprecated|incubating/i.test(line) && /warn|deprecat/i.test(line)) {
            const key = line.slice(0, 80);
            if (seenWarnings.has(key)) return;
            seenWarnings.add(key);
            out(line, 'stdout');
            return;
        }

        // Drop known noise.
        if (line.startsWith('Picked up JAVA_TOOL_OPTIONS')) return;
        if (line.startsWith('> Configure project') && !/error/i.test(line)) return;
        if (line.startsWith('Calculating task graph')) return;
        if (line.startsWith('Note: ') && !/error/i.test(line)) return;
        if (line.startsWith('Daemon will be stopped')) return;
        if (/^Welcome to Gradle /.test(line)) return;

        // Default-drop. If errors/warnings escape, the always-print band catches them.
    };

    const splitter = makeLineSplitter(handleLine);
    return {
        feed: splitter.feed,
        flush: () => {
            splitter.flush();
            if (skippedTaskCount > 0) {
                out(`\x1b[2m▸ ${skippedTaskCount} tasks up-to-date\x1b[0m`, 'stdout');
            }
        },
    };
}

/**
 * Resolve the verbose flag from CLI args and environment. Centralised so
 * every command honours the same conventions: `--verbose`, `SIGX_VERBOSE=1`,
 * and the issue-specific `SIGX_VERBOSE_XCODEBUILD=1` alias.
 */
export function resolveVerbose(flagValue: unknown): boolean {
    if (flagValue === true) return true;
    if (process.env.SIGX_VERBOSE === '1') return true;
    if (process.env.SIGX_VERBOSE_XCODEBUILD === '1') return true;
    return false;
}
