/**
 * Spawn a command that may be a Windows batch shim (`gradlew.bat`,
 * `npx.cmd`, …) without `shell: true`.
 *
 * Node refuses to spawn `.bat`/`.cmd` files directly on Windows, and the
 * usual workaround — `shell: true` plus an args array — is deprecated
 * (DEP0190: the args are concatenated unescaped), and it breaks as soon as
 * the command path contains a space (`D:\my projects\app\android\gradlew.bat`).
 *
 * On Windows we build the cmd.exe command line ourselves, quoting each
 * token, and run it with `windowsVerbatimArguments` — exactly what
 * `shell: true` does internally, minus the unescaped concatenation. On
 * other platforms the command is spawned directly.
 */

import { spawn, spawnSync, type ChildProcess, type SpawnOptions, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';

/**
 * Quote one token for a cmd.exe command line. Anything outside a safe
 * charset is double-quoted — notably `^`, which cmd.exe treats as an escape
 * outside quotes and would strip from semver ranges (`@sigx/lynx-camera@^0.4.0`).
 */
export function quoteCmdArg(arg: string): string {
    if (arg !== '' && /^[\w\-.:\\/=@+,]+$/.test(arg)) return arg;
    return `"${arg.replace(/"/g, '""')}"`;
}

export interface CommandInvocation {
    file: string;
    args: string[];
    /** Extra spawn options the invocation needs (Windows: verbatim args). */
    options: Pick<SpawnOptions, 'windowsVerbatimArguments'>;
}

/**
 * Resolve how to spawn `cmd args` on `platform`. On Windows everything goes
 * through `cmd.exe /d /s /c "<quoted line>"` so PATH shims (`npx`) and batch
 * files (`gradlew.bat`) both resolve the way they do in a terminal.
 */
export function commandInvocation(
    cmd: string,
    args: readonly string[],
    platform: NodeJS.Platform = process.platform,
    env: NodeJS.ProcessEnv = process.env,
): CommandInvocation {
    if (platform !== 'win32') return { file: cmd, args: [...args], options: {} };
    const line = [cmd, ...args].map(quoteCmdArg).join(' ');
    return {
        file: env.ComSpec ?? env.COMSPEC ?? 'cmd.exe',
        args: ['/d', '/s', '/c', `"${line}"`],
        options: { windowsVerbatimArguments: true },
    };
}

/** `spawnSync()` counterpart of {@link spawnCommand}. */
export function spawnCommandSync(cmd: string, args: readonly string[], options: SpawnSyncOptions = {}): SpawnSyncReturns<string | Buffer> {
    const { shell: _ignored, ...rest } = options;
    const inv = commandInvocation(cmd, args);
    return spawnSync(inv.file, inv.args, { ...rest, ...inv.options });
}

/** `spawn()` that handles Windows batch shims without `shell: true`. */
export function spawnCommand(cmd: string, args: readonly string[], options: SpawnOptions = {}): ChildProcess {
    const { shell: _ignored, ...rest } = options;
    const inv = commandInvocation(cmd, args);
    return spawn(inv.file, inv.args, { ...rest, ...inv.options });
}
