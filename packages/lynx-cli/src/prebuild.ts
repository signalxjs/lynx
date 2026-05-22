/**
 * Prebuild orchestration — generates native project files from config.
 *
 * Loads signalx.config.ts, resolves module manifests from node_modules,
 * runs the auto-linkers, scaffolds native projects, and writes all generated
 * code and config into the android/ and ios/ directories.
 */

import {
    readFileSync, existsSync, writeFileSync, unlinkSync,
    mkdirSync, readdirSync, statSync, copyFileSync, rmSync, chmodSync,
} from 'node:fs';
import { join, dirname, relative, extname, basename } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resolveConfig, modulesForPlatform, resolveAssets } from './config/index.js';
import { writeFileIfChanged, copyFileIfChanged } from './util/idempotent-write.js';
import {
    combineHash, getCliVersion,
    readCachedFingerprint, writeCachedFingerprint,
} from './util/build-fingerprint.js';
import {
    iosProjectRoot, iosSourceRoot, iosXcodeProjPath, iosPodfilePath, iosInfoPlistPath,
    androidProjectRoot, androidAppDir, androidKotlinRoot,
    androidManifestPath, androidBuildGradlePath,
} from './config/paths.js';
import { linkAndroid } from './autolink/android.js';
import { linkIos } from './autolink/ios.js';
import { validateManifest } from './manifest.js';
import { generateIosIcon, generateAndroidIcons, generateAndroidAdaptiveIcon } from './assets/icons.js';
import { generateIosSplash, generateAndroidSplash } from './assets/splash.js';
import { applyIosPlistMeta, applyAndroidManifestMeta, applyAndroidGradleMeta } from './assets/manifest.js';
import type { LynxConfig } from './config/index.js';
import type { ResolvedConfig } from './config/parser.js';
import type { ModuleManifest } from './manifest.js';
import type { AndroidLinkResult, DevClientInfo } from './autolink/android.js';
import type { IosLinkResult, IosDevClientInfo } from './autolink/ios.js';

export interface PrebuildOptions {
    android?: boolean;
    ios?: boolean;
    clean?: boolean;
    cwd?: string;
}

function log(msg: string) {
    console.log(`[sigx] ${msg}`);
}

function error(msg: string) {
    console.error(`[sigx] ERROR: ${msg}`);
}

// Binary file extensions that should be copied without substitution
const BINARY_EXTENSIONS = new Set([
    '.jar', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
    '.so', '.dylib', '.a', '.class', '.dex',
]);

/**
 * Resolve the templates directory. Works both in source (src/) and dist (dist/).
 */
function getTemplatesDir(): string {
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = dirname(thisFile);
    // In dist: packages/lynx-cli/dist/prebuild.js → go up to packages/lynx-cli/
    // In src:  packages/lynx-cli/src/prebuild.ts → go up to packages/lynx-cli/
    const packageRoot = dirname(thisDir);
    return join(packageRoot, 'templates');
}

/**
 * Recursively copy a directory, performing template substitutions on text files.
 * Handles special directory names:
 *   __package__  → replaced with packagePath (e.g. com/example/myapp)
 *   __AppName__  → replaced with appName
 */
function copyTemplateDir(
    srcDir: string,
    destDir: string,
    vars: Record<string, string>,
): void {
    const entries = readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = join(srcDir, entry.name);

        // Resolve directory/file name substitutions
        let destName = entry.name;
        if (destName === '__package__' && vars.packagePath) {
            destName = vars.packagePath;
        } else if (destName === '__AppName__' && vars.appName) {
            destName = vars.appName;
        } else if (destName.includes('__AppName__') && vars.appName) {
            destName = destName.replace('__AppName__', vars.appName);
        }

        const destPath = join(destDir, destName);

        if (entry.isDirectory()) {
            mkdirSync(destPath, { recursive: true });
            copyTemplateDir(srcPath, destPath, vars);
        } else {
            const ext = extname(entry.name).toLowerCase();
            if (BINARY_EXTENSIONS.has(ext)) {
                copyFileSync(srcPath, destPath);
            } else {
                let content = readFileSync(srcPath, 'utf-8');
                content = substituteVars(content, vars);
                writeFileSync(destPath, content);
            }
            // Preserve executable bit so scripts like gradlew come out runnable.
            const srcMode = statSync(srcPath).mode;
            if (srcMode & 0o111) chmodSync(destPath, srcMode & 0o777);
        }
    }
}

/**
 * Replace all {{varName}} placeholders in content with values from vars.
 */
function substituteVars(content: string, vars: Record<string, string>): string {
    return content.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return key in vars ? vars[key] : match;
    });
}

/**
 * Sanitize an application/bundle ID to be a valid Java package name.
 * Removes hyphens and other invalid characters from each segment.
 */
function sanitizePackageName(id: string): string {
    return id
        .split('.')
        .map((seg) => seg.replace(/[^a-zA-Z0-9_]/g, '').replace(/^[0-9]/, '_$&'))
        .filter(Boolean)
        .join('.');
}

/**
 * Derive an application ID from the app name.
 * "My Cool App" → "com.sigx.mycoolapp"
 */
function deriveApplicationId(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `com.sigx.${slug || 'app'}`;
}

/**
 * Resolve and sanitize the Android application ID from config.
 */
function resolveApplicationId(config: ResolvedConfig): string {
    const raw = config.android.applicationId ?? deriveApplicationId(config.name);
    return sanitizePackageName(raw);
}
function packageToPath(packageName: string): string {
    return packageName.replace(/\./g, '/');
}

/**
 * Convert a name to PascalCase for Swift type names.
 * "my-app" → "MyApp", "My Cool App" → "MyCoolApp"
 */
function toPascalCase(name: string): string {
    return name
        .replace(/[^a-zA-Z0-9\s-_]/g, '')
        .split(/[\s\-_]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join('');
}

// ────────────────────────────────────────────────────────────────
// Config loading
// ────────────────────────────────────────────────────────────────

/**
 * Load signalx.config.ts from the project root.
 * Uses esbuild to transform TypeScript config files to ESM.
 */
export async function loadConfig(cwd: string): Promise<LynxConfig> {
    const possiblePaths = [
        join(cwd, 'signalx.config.ts'),
        join(cwd, 'signalx.config.js'),
        join(cwd, 'signalx.config.mjs'),
    ];

    let foundPath: string | null = null;
    for (const p of possiblePaths) {
        if (existsSync(p)) {
            foundPath = p;
            break;
        }
    }

    if (!foundPath) {
        // Hard-cut migration: detect the legacy filename and tell the user exactly
        // what to do. Without this, the generic "no config found" message would
        // send them to docs instead of revealing that their file just needs renaming.
        for (const legacy of ['sigx.lynx.config.ts', 'sigx.lynx.config.js', 'sigx.lynx.config.mjs']) {
            if (existsSync(join(cwd, legacy))) {
                const next = legacy.replace('sigx.lynx.config', 'signalx.config');
                throw new Error(
                    `Found legacy ${legacy} — rename to ${next}. ` +
                    'The sigx-lynx config moved to a framework-agnostic name; see CHANGELOG.'
                );
            }
        }

        throw new Error(
            'No signalx.config found.\n' +
            'Create signalx.config.ts in your project root:\n\n' +
            '  import { defineLynxConfig } from "@sigx/lynx-cli/config";\n\n' +
            '  export default defineLynxConfig({ name: "MyApp" });\n'
        );
    }

    if (foundPath.endsWith('.ts')) {
        const esbuild = await import('esbuild');
        const source = readFileSync(foundPath, 'utf-8');

        const result = await esbuild.transform(source, {
            loader: 'ts',
            format: 'esm',
        });

        const configDir = dirname(foundPath);
        const tempFile = join(configDir, `.signalx-config-temp-${Date.now()}.mjs`);

        writeFileSync(tempFile, result.code);

        try {
            const configModule = await import(pathToFileURL(tempFile).href);
            return configModule.default || configModule;
        } finally {
            try {
                unlinkSync(tempFile);
            } catch {
                // Ignore cleanup errors
            }
        }
    }

    // JS/MJS — import directly
    const configModule = await import(pathToFileURL(foundPath).href);
    return configModule.default || configModule;
}

/**
 * Load signalx-module.json manifests from installed module packages.
 */
export async function loadManifests(modulePackages: string[], cwd: string): Promise<ModuleManifest[]> {
    const require = createRequire(join(cwd, 'package.json'));
    const manifests: ModuleManifest[] = [];

    for (const pkg of modulePackages) {
        try {
            const manifestPath = require.resolve(`${pkg}/signalx-module.json`);
            const raw = readFileSync(manifestPath, 'utf-8');
            const manifest = JSON.parse(raw);
            const errors = validateManifest(manifest);

            if (errors.length > 0) {
                throw new Error(`Invalid manifest in ${pkg}: ${errors.join(', ')}`);
            }

            manifests.push(manifest);
        } catch (err: any) {
            if (err.code === 'MODULE_NOT_FOUND') {
                // Differentiate "not installed" from "installed but missing manifest" —
                // the former is almost always a missing `dependencies` entry.
                let pkgInstalled = false;
                try { require.resolve(`${pkg}/package.json`); pkgInstalled = true; } catch { /* not installed */ }
                if (!pkgInstalled) {
                    log(`\x1b[33m!\x1b[0m ${pkg}: not in node_modules — add it to package.json dependencies`);
                } else {
                    log(`\x1b[33m!\x1b[0m ${pkg}: installed but has no signalx-module.json`);
                }
                continue;
            }
            if (err.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
                log(`\x1b[33m!\x1b[0m ${pkg}: installed but signalx-module.json is not exported from its package.json`);
                continue;
            }
            throw err;
        }
    }

    return manifests;
}

// ────────────────────────────────────────────────────────────────
// Android scaffolding & injection
// ────────────────────────────────────────────────────────────────

/**
 * Scaffold the Android project from the template.
 */
export function scaffoldAndroid(cwd: string, config: ResolvedConfig): void {
    const androidDir = join(cwd, 'android');
    const templateDir = join(getTemplatesDir(), 'android');

    if (!existsSync(templateDir)) {
        throw new Error(`Android template not found at ${templateDir}`);
    }

    const vars = androidTemplateVars(config);

    mkdirSync(androidDir, { recursive: true });
    copyTemplateDir(templateDir, androidDir, vars);

    // npm normalizes file modes to 0o644 in tarballs (except `bin` entries), so the
    // exec bit on `gradlew` is lost between publish and install. Force-set it.
    const gradlew = join(androidDir, 'gradlew');
    if (existsSync(gradlew)) chmodSync(gradlew, 0o755);

    log(`Android: scaffolded to ${androidDir}`);
}

/**
 * Write the generated module registry Kotlin file.
 */
export function writeAndroidRegistry(cwd: string, config: ResolvedConfig, registryCode: string): void {
    const applicationId = resolveApplicationId(config);
    const packagePath = packageToPath(applicationId);
    const registryDir = join(androidKotlinRoot(cwd, config), packagePath);
    const registryFile = join(registryDir, 'GeneratedModuleRegistry.kt');

    // Fix the package name in the generated code
    const code = registryCode.replace(
        /^package .*$/m,
        `package ${applicationId}`
    );

    mkdirSync(registryDir, { recursive: true });
    writeFileIfChanged(registryFile, code);
    log(`Android: wrote GeneratedModuleRegistry.kt`);
}

/**
 * Write the generated lifecycle-publishers Kotlin file alongside the module
 * registry. Same package as GeneratedModuleRegistry (via package-line rewrite)
 * so the host can call `GeneratedLifecyclePublishers.attachAll(lynxView)`
 * with no extra import.
 */
export function writeAndroidLifecyclePublishers(cwd: string, config: ResolvedConfig, lifecycleCode: string): void {
    const applicationId = resolveApplicationId(config);
    const packagePath = packageToPath(applicationId);
    const dir = join(androidKotlinRoot(cwd, config), packagePath);
    const file = join(dir, 'GeneratedLifecyclePublishers.kt');

    const code = lifecycleCode.replace(
        /^package .*$/m,
        `package ${applicationId}`
    );

    mkdirSync(dir, { recursive: true });
    writeFileIfChanged(file, code);
    log(`Android: wrote GeneratedLifecyclePublishers.kt`);
}

/**
 * Write the generated Activity-lifecycle hook dispatcher Kotlin file.
 * Same package layout as GeneratedLifecyclePublishers — colocated with the
 * registry so MainActivity can reference it without an extra import.
 */
export function writeAndroidActivityHooks(cwd: string, config: ResolvedConfig, hooksCode: string): void {
    const applicationId = resolveApplicationId(config);
    const packagePath = packageToPath(applicationId);
    const dir = join(androidKotlinRoot(cwd, config), packagePath);
    const file = join(dir, 'GeneratedActivityHooks.kt');

    const code = hooksCode.replace(
        /^package .*$/m,
        `package ${applicationId}`
    );

    mkdirSync(dir, { recursive: true });
    writeFileIfChanged(file, code);
    log(`Android: wrote GeneratedActivityHooks.kt`);
}

/**
 * Inject Gradle dependencies into app/build.gradle.kts.
 */
export function injectGradleDependencies(cwd: string, config: ResolvedConfig, deps: string[], debugDeps: string[] = []): void {
    const gradleFile = androidBuildGradlePath(cwd, config);
    if (!existsSync(gradleFile)) return;

    let content = readFileSync(gradleFile, 'utf-8');

    if (deps.length > 0) {
        const depLines = deps.map((d) => `    implementation("${d}")`).join('\n');
        content = content.replace(
            '    // {{GRADLE_DEPENDENCIES}}',
            `    // Auto-linked module dependencies\n${depLines}`
        );
        log(`Android: injected ${deps.length} Gradle dependencies`);
    }

    if (debugDeps.length > 0) {
        const debugDepLines = debugDeps.map((d) => `    debugImplementation("${d}")`).join('\n');
        content = content.replace(
            '    // {{DEBUG_GRADLE_DEPENDENCIES}}',
            `    // Auto-linked debug dependencies\n${debugDepLines}`
        );
        log(`Android: injected ${debugDeps.length} debug Gradle dependencies`);
    }

    writeFileIfChanged(gradleFile, content);
}

/**
 * Inject permissions into AndroidManifest.xml.
 */
export function injectAndroidPermissions(cwd: string, config: ResolvedConfig, permissions: string[]): void {
    if (permissions.length === 0) return;

    const manifestFile = androidManifestPath(cwd, config);
    if (!existsSync(manifestFile)) return;

    let content = readFileSync(manifestFile, 'utf-8');
    const permLines = permissions
        .map((p) => `    <uses-permission android:name="${p}" />`)
        .join('\n');
    content = content.replace(
        '    <!-- {{PERMISSIONS}} -->',
        `    <!-- Auto-linked module permissions -->\n${permLines}`
    );
    writeFileIfChanged(manifestFile, content);
    log(`Android: injected ${permissions.length} permissions`);
}

/**
 * Copy dev-client Kotlin sources into the Android project.
 *
 * Resolves the dev-client package from node_modules, copies all .kt files
 * from its sourceDir into the app's kotlin source tree under the
 * dev-client's own package directory.
 */
export function copyDevClientSources(cwd: string, config: ResolvedConfig, devClientInfo: import('./autolink/android.js').DevClientInfo): void {
    const require = createRequire(join(cwd, 'package.json'));

    let pkgDir: string;
    try {
        const pkgJson = require.resolve(`${devClientInfo.packageName}/package.json`);
        pkgDir = dirname(pkgJson);
    } catch {
        log(`Dev client ${devClientInfo.packageName} not found in node_modules, skipping source copy`);
        return;
    }

    const sourceRoot = join(pkgDir, devClientInfo.sourceDir);
    if (!existsSync(sourceRoot)) {
        log(`Dev client source dir not found: ${sourceRoot}`);
        return;
    }

    const destRoot = androidKotlinRoot(cwd, config);

    // Recursively copy all files from sourceRoot preserving directory structure
    function copyRecursive(src: string, dest: string) {
        const entries = readdirSync(src);
        for (const entry of entries) {
            const srcPath = join(src, entry);
            const destPath = join(dest, entry);
            const stat = statSync(srcPath);
            if (stat.isDirectory()) {
                mkdirSync(destPath, { recursive: true });
                copyRecursive(srcPath, destPath);
            } else {
                mkdirSync(dirname(destPath), { recursive: true });
                copyFileIfChanged(srcPath, destPath);
            }
        }
    }

    copyRecursive(sourceRoot, destRoot);
    log(`Android: copied dev-client sources from ${devClientInfo.packageName}`);
}

/**
 * Copy each linked module's Android Kotlin sources from its package's
 * `sourceDir` into the consumer's Kotlin source tree. Sources retain their
 * own package declarations (each module declares `package com.sigx.<x>`),
 * so they land in the right Kotlin package automatically — we just need
 * the file bytes present somewhere under `app/src/main/kotlin/`.
 *
 * Mirrors `copyDevClientSources` but iterates over every manifest with a
 * non-dev-client `android.sourceDir`. Idempotent — overwrites the destination.
 */
export function copyAndroidModuleSources(cwd: string, config: ResolvedConfig, manifests: ModuleManifest[]): void {
    const require = createRequire(join(cwd, 'package.json'));
    const destRoot = androidKotlinRoot(cwd, config);

    let copiedPackages = 0;
    for (const manifest of manifests) {
        if (manifest.type === 'dev-client') continue; // dev-client has its own copy path
        const android = manifest.android;
        if (!android?.sourceDir) continue;

        let pkgDir: string;
        try {
            // Resolve via signalx-module.json (which we know is exported — it
            // had to be for autolink to find the manifest in the first place)
            // rather than package.json (which packages with `exports` fields
            // don't always expose).
            const manifestPath = require.resolve(`${manifest.package}/signalx-module.json`);
            pkgDir = dirname(manifestPath);
        } catch (e) {
            log(`${manifest.package}: not in node_modules, skipping Android source copy (${(e as Error).message})`);
            continue;
        }

        const sourceRoot = join(pkgDir, android.sourceDir);
        if (!existsSync(sourceRoot)) {
            log(`${manifest.package}: Android sourceDir "${android.sourceDir}" not found, skipping`);
            continue;
        }

        copyDirRecursive(sourceRoot, destRoot);
        copiedPackages++;
    }
    if (copiedPackages > 0) {
        log(`Android: copied native sources from ${copiedPackages} package(s)`);
    }
}

/**
 * Copy each linked module's iOS Swift sources from its package's
 * `sourceDir` into a managed `<iosSourceRoot>/Generated/Modules/` directory
 * and register the copied files in the Xcode project so they compile.
 *
 * Lifecycle publishers go to `Generated/LifecyclePublishers/` so the two
 * concerns can be browsed independently in Xcode's project navigator.
 */
export function copyIosModuleSources(cwd: string, config: ResolvedConfig, manifests: ModuleManifest[]): void {
    const require = createRequire(join(cwd, 'package.json'));
    // Group names match the destination dir names — Xcode resolves
    // `sourceTree = "<group>"` files relative to their group's path.
    const moduleDest = join(iosSourceRoot(cwd, config), 'GeneratedModules');
    const lifecycleDest = join(iosSourceRoot(cwd, config), 'GeneratedLifecyclePublishers');

    const moduleFiles: string[] = [];
    const lifecycleFiles: string[] = [];

    for (const manifest of manifests) {
        if (manifest.type === 'dev-client') continue;
        const ios = manifest.ios;
        if (!ios?.sourceDir) continue;

        let pkgDir: string;
        try {
            // Resolve via signalx-module.json (always exported); package.json
            // isn't always exposed when an `exports` field exists.
            const manifestPath = require.resolve(`${manifest.package}/signalx-module.json`);
            pkgDir = dirname(manifestPath);
        } catch (e) {
            log(`${manifest.package}: not in node_modules, skipping iOS source copy (${(e as Error).message})`);
            continue;
        }

        const sourceRoot = join(pkgDir, ios.sourceDir);
        if (!existsSync(sourceRoot)) {
            log(`${manifest.package}: iOS sourceDir "${ios.sourceDir}" not found, skipping`);
            continue;
        }

        // A manifest can declare a moduleClass, a publisherClass, or both.
        // Source files all live under the same `sourceDir` and compile into
        // one target either way — the two destination folders just keep the
        // Xcode navigator readable. Manifests with a publisher land in
        // GeneratedLifecyclePublishers; pure-module manifests in
        // GeneratedModules. (Combined manifests pick LifecyclePublishers —
        // the choice is purely organisational.)
        const hasPublisher = !!manifest.ios?.publisherClass;
        const dest = hasPublisher ? lifecycleDest : moduleDest;
        mkdirSync(dest, { recursive: true });

        const swiftFiles = collectSwiftFiles(sourceRoot);
        for (const swift of swiftFiles) {
            // `basename` (not split('/').pop()) so absolute Windows paths
            // resolve correctly — the latter returns the full path
            // unchanged on Windows since there's no forward slash, and
            // join(dest, …) then nests the entire source path under dest.
            const fileName = basename(swift);
            copyFileIfChanged(swift, join(dest, fileName));
            (hasPublisher ? lifecycleFiles : moduleFiles).push(fileName);
        }
    }

    if (moduleFiles.length > 0) {
        addFilesToXcodeProject(cwd, config, 'GeneratedModules', moduleFiles);
    }
    if (lifecycleFiles.length > 0) {
        addFilesToXcodeProject(cwd, config, 'GeneratedLifecyclePublishers', lifecycleFiles);
    }
    if (moduleFiles.length + lifecycleFiles.length > 0) {
        log(`iOS: copied ${moduleFiles.length} module + ${lifecycleFiles.length} lifecycle Swift file(s)`);
    }
}

function copyDirRecursive(src: string, dest: string): void {
    const entries = readdirSync(src);
    for (const entry of entries) {
        const srcPath = join(src, entry);
        const destPath = join(dest, entry);
        const stat = statSync(srcPath);
        if (stat.isDirectory()) {
            mkdirSync(destPath, { recursive: true });
            copyDirRecursive(srcPath, destPath);
        } else {
            mkdirSync(dirname(destPath), { recursive: true });
            copyFileIfChanged(srcPath, destPath);
        }
    }
}

function collectSwiftFiles(root: string): string[] {
    const out: string[] = [];
    function walk(d: string): void {
        for (const entry of readdirSync(d)) {
            const p = join(d, entry);
            const s = statSync(p);
            if (s.isDirectory()) walk(p);
            else if (entry.endsWith('.swift')) out.push(p);
        }
    }
    walk(root);
    return out;
}

/**
 * Auto-discover sigx native module packages installed in the consumer app.
 *
 * Iterates the app's direct dependencies (and devDependencies, so packages
 * scoped to dev like @sigx/lynx-dev-client still get linked) and includes
 * any whose `signalx-module.json` is resolvable. Skips packages already in
 * `existingPackages` (i.e. declared via `modules:` in the config) and
 * anything listed in `excludeModules`.
 *
 * The presence of `signalx-module.json` IS the "this is a Lynx native module"
 * marker — packages without it (icons, navigation, etc.) are silently ignored.
 */
export async function discoverSigxPackages(
    cwd: string,
    existingPackages: string[],
    excludeModules: string[] = [],
): Promise<string[]> {
    const discovered: string[] = [];
    const require = createRequire(join(cwd, 'package.json'));

    let pkgJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
        pkgJson = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    } catch {
        // No package.json — nothing to scan.
        return discovered;
    }

    const existing = new Set(existingPackages);
    const excluded = new Set(excludeModules);
    const candidates = new Set<string>([
        ...Object.keys(pkgJson.dependencies ?? {}),
        ...Object.keys(pkgJson.devDependencies ?? {}),
    ]);

    for (const pkg of candidates) {
        if (existing.has(pkg) || excluded.has(pkg)) continue;
        try {
            require.resolve(`${pkg}/signalx-module.json`);
            discovered.push(pkg);
        } catch {
            // Either MODULE_NOT_FOUND (package isn't a Lynx module / not installed)
            // or ERR_PACKAGE_PATH_NOT_EXPORTED (package's `exports` field doesn't
            // list this subpath — fires for every non-Lynx package that uses
            // exports). Both are expected for the vast majority of deps; surfacing
            // either as a warning would drown the user in false positives.
        }
    }

    return discovered;
}

/**
 * Check the dev-client version and warn if it doesn't match the CLI version.
 */
export function checkDevClientVersion(cwd: string, devClientPkg: string): void {
    const require = createRequire(join(cwd, 'package.json'));
    try {
        const pkgJsonPath = require.resolve(`${devClientPkg}/package.json`);
        const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        const devClientVersion = pkgJson.version;

        // Read CLI's own version for comparison
        const cliPkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
        if (existsSync(cliPkgPath)) {
            const cliPkg = JSON.parse(readFileSync(cliPkgPath, 'utf-8'));
            const cliVersion = cliPkg.version;
            if (devClientVersion !== cliVersion) {
                log(`⚠ Dev client v${devClientVersion} differs from CLI v${cliVersion}. Run: pnpm update ${devClientPkg}`);
            }
        }
        log(`Dev client: ${devClientPkg}@${devClientVersion}`);
    } catch {
        // Package not installed
    }
}

// ────────────────────────────────────────────────────────────────
// iOS scaffolding & injection
// ────────────────────────────────────────────────────────────────

/**
 * Files that are always refreshed from the template on every prebuild.
 *
 * These are dev-client integration glue — they evolve alongside SigxDevClient
 * and must stay in sync with the installed dev-client version. Paths are
 * relative to `ios/<appName>/`.
 *
 * Users shouldn't edit these directly; user code lives in src/App.tsx.
 */
const MANAGED_IOS_FILES = [
    'App.swift',
    'ContentView.swift',
    'Services/LynxSetupService.swift',
    // Info.plist is fully driven by config (orientation, scheme, buildNumber,
    // launch screen, usage descriptions). Refreshing it every prebuild keeps
    // those values in sync without requiring --clean.
    'Info.plist',
];

function iosTemplateVars(config: ResolvedConfig): Record<string, string> {
    return {
        appName: config.name,
        appNamePascal: toPascalCase(config.name),
        bundleIdentifier: config.ios.bundleIdentifier ?? deriveApplicationId(config.name),
        deploymentTarget: config.ios.deploymentTarget,
        versionName: config.version,
        buildNumber: config.ios.buildNumber,
    };
}

/**
 * Files re-copied from the Android template on every prebuild so config
 * changes (versionCode, orientation, scheme, splash theme) propagate.
 * Paths are relative to `templates/android/`.
 *
 * MainActivity.kt is managed because its body is intentionally just
 * lifecycle plumbing that delegates to the auto-generated
 * `GeneratedActivityHooks` and `GeneratedLifecyclePublishers`. App-level
 * customizations (custom Compose UI, services, etc.) belong in separate
 * files; the template's MainActivity is framework code that needs to stay
 * in lockstep with the autolinker.
 */
const MANAGED_ANDROID_FILES = [
    'app/src/main/AndroidManifest.xml',
    'app/src/main/res/values/themes.xml',
    'app/src/main/res/xml/file_provider_paths.xml',
    'app/build.gradle.kts',
    'app/src/main/kotlin/__package__/MainActivity.kt',
];

function androidTemplateVars(config: ResolvedConfig): Record<string, string> {
    const applicationId = resolveApplicationId(config);
    return {
        appName: config.name,
        applicationId,
        packageName: applicationId,
        packagePath: packageToPath(applicationId),
        minSdk: String(config.android.minSdk),
        targetSdk: String(config.android.targetSdk),
        compileSdk: String(config.android.compileSdk),
        versionName: config.version,
        versionCode: String(config.android.versionCode),
    };
}

/**
 * Refresh managed Android files (AndroidManifest, themes, build.gradle) from
 * the template. Runs every prebuild — these files are config-driven so
 * regenerating from the template guarantees users see updated values without
 * needing --clean. Re-injection of Gradle deps / permissions / orientation /
 * intent-filter happens after this in runPrebuild.
 */
export function refreshAndroidManagedFiles(cwd: string, config: ResolvedConfig): void {
    const templateDir = join(getTemplatesDir(), 'android');
    const vars = androidTemplateVars(config);
    let refreshed = 0;
    for (const rel of MANAGED_ANDROID_FILES) {
        const srcPath = join(templateDir, rel);
        // Resolve `__package__` segments in the destination path the same way
        // `copyTemplateDir` does for the initial scaffold, so MainActivity.kt
        // (which lives at `kotlin/__package__/`) lands in the correct
        // applicationId-derived directory.
        const resolvedRel = rel.split('/').map((seg) =>
            seg === '__package__' ? vars.packagePath : seg,
        ).join('/');
        const destPath = join(cwd, 'android', resolvedRel);
        if (!existsSync(srcPath)) continue;
        const content = substituteVars(readFileSync(srcPath, 'utf-8'), vars);
        mkdirSync(dirname(destPath), { recursive: true });
        if (writeFileIfChanged(destPath, content)) refreshed++;
    }
    if (refreshed > 0) log(`Android: refreshed ${refreshed} managed config files`);
}

/**
 * Scaffold the iOS project from the template.
 */
export function scaffoldIos(cwd: string, config: ResolvedConfig): void {
    const iosDir = join(cwd, 'ios');
    const templateDir = join(getTemplatesDir(), 'ios');

    if (!existsSync(templateDir)) {
        throw new Error(`iOS template not found at ${templateDir}`);
    }

    const vars = iosTemplateVars(config);

    mkdirSync(iosDir, { recursive: true });
    copyTemplateDir(templateDir, iosDir, vars);

    log(`iOS: scaffolded to ${iosDir}`);
}

/**
 * Refresh managed iOS integration files (App.swift, ContentView.swift,
 * LynxSetupService.swift) from the template. Runs every prebuild so changes
 * to the dev-client integration ripple into existing projects.
 */
export function refreshIosManagedFiles(cwd: string, config: ResolvedConfig): void {
    const templateRootDir = join(getTemplatesDir(), 'ios');
    const templateAppDir = join(templateRootDir, '__AppName__');
    if (!existsSync(templateAppDir)) return;

    const vars = iosTemplateVars(config);
    const destAppDir = join(cwd, 'ios', config.name);

    let refreshed = 0;
    for (const rel of MANAGED_IOS_FILES) {
        const srcPath = join(templateAppDir, rel);
        const destPath = join(destAppDir, rel);
        if (!existsSync(srcPath)) continue;
        const content = substituteVars(readFileSync(srcPath, 'utf-8'), vars);
        mkdirSync(dirname(destPath), { recursive: true });
        if (writeFileIfChanged(destPath, content)) refreshed++;
    }

    // Refresh Podfile. This carries Lynx SDK pod declarations that must track
    // the installed SDK version. {{POD_ENTRIES}} / {{DEBUG_POD_ENTRIES}}
    // placeholders are then re-injected by the autolinker.
    const podfileSrc = join(templateRootDir, 'Podfile');
    const podfileDest = join(cwd, 'ios', 'Podfile');
    if (existsSync(podfileSrc)) {
        const content = substituteVars(readFileSync(podfileSrc, 'utf-8'), vars);
        if (writeFileIfChanged(podfileDest, content)) refreshed++;
    }

    if (refreshed > 0) {
        log(`iOS: refreshed ${refreshed} managed integration files`);
    }
}

/**
 * Write the generated module registry Swift file.
 */
export function writeIosRegistry(cwd: string, config: ResolvedConfig, registryCode: string): void {
    // Historic apps (sigx-init pre-host-mode) referenced this file at the
    // app source root, not in a `Generated/` subdir, so we keep it there.
    // The pbxproj template at `templates/ios/__AppName__.xcodeproj/` has a
    // top-level entry pointing at this exact path; auto-link doesn't need
    // to register it.
    const registryFile = join(iosSourceRoot(cwd, config), 'GeneratedModuleRegistry.swift');
    mkdirSync(dirname(registryFile), { recursive: true });
    writeFileIfChanged(registryFile, registryCode);
    log(`iOS: wrote GeneratedModuleRegistry.swift`);
}

/**
 * Write the generated lifecycle-publishers Swift file alongside the module
 * registry. Hosts call `GeneratedLifecyclePublishers.attachAll(to:)` after
 * building each LynxView and retain the returned array.
 */
export function writeIosLifecyclePublishers(cwd: string, config: ResolvedConfig, lifecycleCode: string): void {
    // Same convention as GeneratedModuleRegistry — top-level file. The
    // template's pbxproj seeds an entry, so addFilesToXcodeProject only runs
    // for projects that DIDN'T scaffold from the current template (legacy
    // apps), where it'd register at the source root.
    const file = join(iosSourceRoot(cwd, config), 'GeneratedLifecyclePublishers.swift');
    mkdirSync(dirname(file), { recursive: true });
    writeFileIfChanged(file, lifecycleCode);
    addFilesToXcodeProject(cwd, config, '', ['GeneratedLifecyclePublishers.swift']);
    log(`iOS: wrote GeneratedLifecyclePublishers.swift`);
}

/**
 * Write the generated AppDelegate hook dispatcher Swift file. Sibling to the
 * registry/lifecycle files so AppDelegate.swift can reference it without an
 * import.
 */
export function writeIosAppDelegateHooks(cwd: string, config: ResolvedConfig, hooksCode: string): void {
    const file = join(iosSourceRoot(cwd, config), 'GeneratedAppDelegateHooks.swift');
    mkdirSync(dirname(file), { recursive: true });
    writeFileIfChanged(file, hooksCode);
    addFilesToXcodeProject(cwd, config, '', ['GeneratedAppDelegateHooks.swift']);
    log(`iOS: wrote GeneratedAppDelegateHooks.swift`);
}

/**
 * Inject pod entries into the Podfile.
 */
export function injectPodfileEntries(cwd: string, config: ResolvedConfig, pods: string[]): void {
    const podfile = iosPodfilePath(cwd, config);
    if (!existsSync(podfile)) return;

    let content = readFileSync(podfile, 'utf-8');
    const replacement = pods.length > 0
        ? `  # Auto-linked module pods\n${pods.join('\n')}`
        : '  # (no auto-linked module pods)';
    content = content.replace('  # {{POD_ENTRIES}}', replacement);
    writeFileIfChanged(podfile, content);
    if (pods.length > 0) log(`iOS: injected ${pods.length} pod entries`);
}

/**
 * Inject usage descriptions into Info.plist.
 */
export function injectInfoPlistDescriptions(
    cwd: string,
    config: ResolvedConfig,
    descriptions: Record<string, string>,
): void {
    const keys = Object.keys(descriptions);
    const plistFile = iosInfoPlistPath(cwd, config);
    if (!existsSync(plistFile)) return;

    let content = readFileSync(plistFile, 'utf-8');
    const replacement = keys.length > 0
        ? `    <!-- Auto-linked module usage descriptions -->\n${
            keys.map((k) => `    <key>${k}</key>\n    <string>${descriptions[k]}</string>`).join('\n')
          }`
        : '    <!-- (no auto-linked usage descriptions) -->';
    content = content.replace('    <!-- {{USAGE_DESCRIPTIONS}} -->', replacement);
    writeFileIfChanged(plistFile, content);
    if (keys.length > 0) log(`iOS: injected ${keys.length} usage descriptions`);
}

/**
 * Inject debug-only pod entries into the Podfile.
 */
export function injectDebugPodfileEntries(cwd: string, config: ResolvedConfig, pods: string[]): void {
    const podfile = iosPodfilePath(cwd, config);
    if (!existsSync(podfile)) return;

    let content = readFileSync(podfile, 'utf-8');
    const replacement = pods.length > 0
        ? `  # Debug-only auto-linked pods\n${pods.join('\n')}`
        : '  # (no auto-linked debug pods)';
    content = content.replace('  # {{DEBUG_POD_ENTRIES}}', replacement);
    writeFileIfChanged(podfile, content);
    if (pods.length > 0) log(`iOS: injected ${pods.length} debug pod entries`);
}

/**
 * Copy dev-client Swift sources into the iOS project.
 *
 * Resolves the dev-client package from node_modules, copies all .swift files
 * from its sourceDir into ios/<appName>/SigxDevClient/.
 * Also registers the files in the Xcode project.
 */
export function copyDevClientSourcesIos(
    cwd: string,
    config: ResolvedConfig,
    devClientInfo: IosDevClientInfo,
): void {
    const require = createRequire(join(cwd, 'package.json'));

    let pkgDir: string;
    try {
        const pkgJson = require.resolve(`${devClientInfo.packageName}/package.json`);
        pkgDir = dirname(pkgJson);
    } catch {
        log(`Dev client ${devClientInfo.packageName} not found in node_modules, skipping iOS source copy`);
        return;
    }

    const sourceRoot = join(pkgDir, devClientInfo.sourceDir);
    if (!existsSync(sourceRoot)) {
        log(`Dev client iOS source dir not found: ${sourceRoot}`);
        return;
    }

    const destRoot = join(iosSourceRoot(cwd, config), 'SigxDevClient');
    const copiedFiles: string[] = [];

    // Recursively copy all files preserving directory structure
    function copyRecursive(src: string, dest: string) {
        const entries = readdirSync(src);
        for (const entry of entries) {
            const srcPath = join(src, entry);
            const destPath = join(dest, entry);
            const stat = statSync(srcPath);
            if (stat.isDirectory()) {
                mkdirSync(destPath, { recursive: true });
                copyRecursive(srcPath, destPath);
            } else {
                mkdirSync(dirname(destPath), { recursive: true });
                copyFileIfChanged(srcPath, destPath);
                if (entry.endsWith('.swift')) {
                    copiedFiles.push(entry);
                }
            }
        }
    }

    copyRecursive(sourceRoot, destRoot);

    // Register the copied Swift files in the Xcode project
    if (copiedFiles.length > 0) {
        addFilesToXcodeProject(cwd, config, 'SigxDevClient', copiedFiles);
    }

    log(`iOS: copied dev-client sources from ${devClientInfo.packageName}`);
}

/**
 * Add Swift source files to the Xcode project's pbxproj.
 *
 * Idempotent: files already registered in the target group are left alone.
 * Injects file references, build file entries, group children, and source
 * build phase entries into the template placeholders.
 */
function addFilesToXcodeProject(
    cwd: string,
    config: ResolvedConfig,
    groupName: string,
    fileNames: string[],
): void {
    const pbxprojPath = join(iosXcodeProjPath(cwd, config), 'project.pbxproj');
    if (!existsSync(pbxprojPath)) return;

    let content = readFileSync(pbxprojPath, 'utf-8');

    // Deterministic UUIDs so the same file always gets the same UUID.
    function fileUUID(prefix: string, name: string): string {
        let hash = 0;
        const str = prefix + name;
        for (let i = 0; i < str.length; i++) {
            const chr = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + chr;
            hash |= 0;
        }
        const hex = Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
        return `DC${prefix.slice(0, 2)}${hex}0000`.padEnd(24, '0').slice(0, 24);
    }

    const groupUUID = fileUUID('GR', groupName);
    const hasGroup = content.includes(`${groupUUID} /* ${groupName} */`);

    // Filter out files already registered (idempotence).
    const newFiles = fileNames.filter((f) => !content.includes(`/* ${f} in Sources */`));
    const skippedCount = fileNames.length - newFiles.length;

    if (newFiles.length === 0 && hasGroup) {
        if (skippedCount > 0) {
            log(`iOS: Xcode project already has ${skippedCount} ${groupName} source files`);
        }
        return;
    }

    const buildFileLines: string[] = [];
    const fileRefLines: string[] = [];
    const groupFileRefs: string[] = [];
    const sourceFileLines: string[] = [];

    for (const fileName of newFiles) {
        const buildUUID = fileUUID('BF', fileName);
        const refUUID = fileUUID('FR', fileName);

        buildFileLines.push(
            `\t\t${buildUUID} /* ${fileName} in Sources */ = {isa = PBXBuildFile; fileRef = ${refUUID} /* ${fileName} */; };`
        );
        fileRefLines.push(
            `\t\t${refUUID} /* ${fileName} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${fileName}; sourceTree = "<group>"; };`
        );
        groupFileRefs.push(
            `\t\t\t\t${refUUID} /* ${fileName} */,`
        );
        sourceFileLines.push(
            `\t\t\t\t${buildUUID} /* ${fileName} in Sources */,`
        );
    }

    // Inject at section markers that exist in every pbxproj. Falls back to
    // `{{EXTRA_*}}` placeholders if the project has them pre-seeded (Go host's
    // hand-curated pbxproj does), but the section-marker path is what makes
    // existing user pbxprojs Just Work without any manual setup.

    // Inject build file entries (PBXBuildFile section).
    if (buildFileLines.length > 0) {
        const payload = buildFileLines.join('\n');
        if (content.includes('/* {{EXTRA_BUILD_FILES}} */')) {
            content = content.replace(
                '/* {{EXTRA_BUILD_FILES}} */',
                payload + '\n/* {{EXTRA_BUILD_FILES}} */'
            );
        } else {
            content = content.replace(
                '/* End PBXBuildFile section */',
                payload + '\n/* End PBXBuildFile section */'
            );
        }
    }

    // Empty groupName == "register at the parent group level" — no new
    // PBXGroup is created. Used for top-level managed files like
    // GeneratedModuleRegistry.swift / GeneratedLifecyclePublishers.swift
    // that live at the iOS source root, not in a subdirectory.
    const skipGroup = groupName === '';

    if (skipGroup) {
        const fileRefPayload = fileRefLines.join('\n');
        if (fileRefPayload) {
            if (content.includes('/* {{EXTRA_FILE_REFS}} */')) {
                content = content.replace(
                    '/* {{EXTRA_FILE_REFS}} */',
                    fileRefPayload + '\n/* {{EXTRA_FILE_REFS}} */'
                );
            } else {
                content = content.replace(
                    '/* End PBXFileReference section */',
                    fileRefPayload + '\n/* End PBXFileReference section */'
                );
            }
            // Add file refs directly to the app's main group children.
            const appNameRegex = new RegExp(
                `(\\/\\* ${escapeRegex(config.name)} \\*\\/ = \\{[\\s\\S]*?children = \\(\\s*\\n)([\\s\\S]*?)(\\s*\\);[\\s\\S]*?path = "?${escapeRegex(config.name)}"?;)`,
            );
            content = content.replace(appNameRegex, (_m, open, existing, close) => {
                return open + existing + groupFileRefs.join('\n') + '\n' + close;
            });
        }
    } else if (!hasGroup) {
        // Create the group and file refs at the same time.
        const groupEntry = [
            `\t\t${groupUUID} /* ${groupName} */ = {`,
            `\t\t\tisa = PBXGroup;`,
            `\t\t\tchildren = (`,
            ...groupFileRefs,
            `\t\t\t);`,
            `\t\t\tname = ${groupName};`,
            `\t\t\tpath = ${groupName};`,
            `\t\t\tsourceTree = "<group>";`,
        ].join('\n') + '\n\t\t};';

        const fileRefPayload = fileRefLines.join('\n') + '\n' + groupEntry;
        if (content.includes('/* {{EXTRA_FILE_REFS}} */')) {
            content = content.replace(
                '/* {{EXTRA_FILE_REFS}} */',
                fileRefPayload + '\n/* {{EXTRA_FILE_REFS}} */'
            );
        } else {
            content = content.replace(
                '/* End PBXFileReference section */',
                fileRefPayload + '\n/* End PBXFileReference section */'
            );
        }

        // Add the group reference to the app's main group children. The main
        // group is the FIRST PBXGroup whose `path` matches the app name, OR
        // the first PBXGroup if path doesn't match (legacy projects).
        const groupRefLine = `\t\t\t\t${groupUUID} /* ${groupName} */,`;
        if (content.includes('/* {{EXTRA_GROUP_CHILDREN}} */')) {
            content = content.replace(
                '/* {{EXTRA_GROUP_CHILDREN}} */',
                groupRefLine + '\n\t\t\t/* {{EXTRA_GROUP_CHILDREN}} */'
            );
        } else {
            // Find the first PBXGroup whose path equals the config app name.
            const appNameRegex = new RegExp(
                `(\\/\\* ${escapeRegex(config.name)} \\*\\/ = \\{[\\s\\S]*?children = \\(\\s*\\n)([\\s\\S]*?)(\\s*\\);[\\s\\S]*?path = "?${escapeRegex(config.name)}"?;)`,
            );
            if (appNameRegex.test(content)) {
                content = content.replace(appNameRegex, (_m, open, existing, close) => {
                    return open + existing + groupRefLine + '\n' + close;
                });
            }
        }
    } else if (fileRefLines.length > 0) {
        // Group already exists; append file refs into the group and file-ref section.
        const fileRefPayload = fileRefLines.join('\n');
        if (content.includes('/* {{EXTRA_FILE_REFS}} */')) {
            content = content.replace(
                '/* {{EXTRA_FILE_REFS}} */',
                fileRefPayload + '\n/* {{EXTRA_FILE_REFS}} */'
            );
        } else {
            content = content.replace(
                '/* End PBXFileReference section */',
                fileRefPayload + '\n/* End PBXFileReference section */'
            );
        }

        // Insert new file refs into the existing group's children list.
        const groupPattern = new RegExp(
            `(${groupUUID} /\\* ${groupName} \\*/ = \\{[\\s\\S]*?children = \\()([\\s\\S]*?)(\\s*\\);)`,
        );
        content = content.replace(groupPattern, (_m, open, existing, close) => {
            return open + existing + '\n' + groupFileRefs.join('\n') + close;
        });
    }

    if (sourceFileLines.length > 0) {
        const payload = sourceFileLines.join('\n');
        if (content.includes('/* {{EXTRA_SOURCE_FILES}} */')) {
            content = content.replace(
                '/* {{EXTRA_SOURCE_FILES}} */',
                payload + '\n\t\t\t\t/* {{EXTRA_SOURCE_FILES}} */'
            );
        } else {
            // Inject before the closing `);` of the first PBXSourcesBuildPhase's
            // files list. Anchor on the section start marker so we only match
            // the Sources phase (not Frameworks or Resources).
            content = content.replace(
                /(isa = PBXSourcesBuildPhase;[\s\S]*?files = \([\s\S]*?)(\s*\);)/,
                (_m, before, close) => before + '\n' + payload + close,
            );
        }
    }

    writeFileIfChanged(pbxprojPath, content);
    if (newFiles.length > 0) {
        log(`iOS: registered ${newFiles.length} new ${groupName} source files in Xcode project`);
    }
    if (skippedCount > 0) {
        log(`iOS: ${skippedCount} ${groupName} files already registered`);
    }
}

/** Escape a string for use inside a RegExp literal. */
function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ────────────────────────────────────────────────────────────────
// Clean
// ────────────────────────────────────────────────────────────────

/**
 * Clean generated prebuild artifacts.
 */
export function cleanPrebuild(cwd: string, config: ResolvedConfig, full: boolean): void {
    if (full) {
        const androidDir = join(cwd, 'android');
        const iosDir = join(cwd, 'ios');
        if (existsSync(androidDir)) {
            rmSync(androidDir, { recursive: true, force: true });
            log('Cleaned android/ directory');
        }
        if (existsSync(iosDir)) {
            rmSync(iosDir, { recursive: true, force: true });
            log('Cleaned ios/ directory');
        }
        return;
    }

    // Partial clean — only remove generated registry files
    const applicationId = resolveApplicationId(config);
    const packagePath = packageToPath(applicationId);
    const androidRegistry = join(cwd, 'android', 'app', 'src', 'main', 'kotlin', packagePath, 'GeneratedModuleRegistry.kt');
    const iosRegistry = join(cwd, 'ios', config.name, 'GeneratedModuleRegistry.swift');

    if (existsSync(androidRegistry)) {
        unlinkSync(androidRegistry);
        log('Cleaned Android GeneratedModuleRegistry.kt');
    }
    if (existsSync(iosRegistry)) {
        unlinkSync(iosRegistry);
        log('Cleaned iOS GeneratedModuleRegistry.swift');
    }
}

// ────────────────────────────────────────────────────────────────
// Main pipeline
// ────────────────────────────────────────────────────────────────

/**
 * Hash of everything that drives prebuild's output: the user config files,
 * the project's resolved `signalx-module.json` set (from node_modules), the
 * CLI version, and which platforms we're building. Used to short-circuit
 * runPrebuild when nothing it cares about has changed since the last run.
 *
 * Notably does NOT hash any files under `android/` or `ios/` — those are
 * outputs, not inputs. User edits to native source files are preserved
 * either way (prebuild only touches managed files via writeFileIfChanged).
 */
function fingerprintPrebuildInputs(cwd: string, platforms: { android: boolean; ios: boolean }): string {
    const files: string[] = [];

    for (const name of ['signalx.config.ts', 'signalx.config.js', 'signalx.config.mjs', 'lynx.config.ts', 'lynx.config.js', 'lynx.config.mjs']) {
        const p = join(cwd, name);
        if (existsSync(p)) files.push(p);
    }
    files.push(join(cwd, 'package.json'));

    const req = createRequire(join(cwd, 'package.json'));
    let pkgJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
        pkgJson = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    } catch {
        pkgJson = {};
    }
    const candidates = new Set([
        ...Object.keys(pkgJson.dependencies ?? {}),
        ...Object.keys(pkgJson.devDependencies ?? {}),
    ]);
    for (const pkg of [...candidates].sort()) {
        try { files.push(req.resolve(`${pkg}/signalx-module.json`)); } catch { /* not a sigx module */ }
    }

    return combineHash(files.sort(), {
        cliVersion: getCliVersion(),
        platforms: `android=${platforms.android};ios=${platforms.ios}`,
    });
}

/**
 * Run the full prebuild pipeline:
 * 1. Load config
 * 2. Scaffold native projects (if missing)
 * 3. Auto-link modules
 * 4. Write generated code and inject dependencies/permissions
 *
 * Skipped entirely when the input fingerprint matches the last successful
 * run AND the native project dirs we'd be generating into still exist.
 * Pass `--clean` (or `opts.clean`) to force a re-run.
 */
export async function runPrebuild(opts: PrebuildOptions = {}): Promise<void> {
    const cwd = opts.cwd || process.cwd();
    const buildAndroid = opts.android ?? true;
    const buildIos = opts.ios ?? true;

    // Fast path: skip the whole pipeline (including the esbuild-driven config
    // load) when the inputs haven't changed since the last run AND the native
    // project dirs we'd populate already exist. `--clean` bypasses.
    if (!opts.clean) {
        const fingerprint = fingerprintPrebuildInputs(cwd, { android: buildAndroid, ios: buildIos });
        const cached = readCachedFingerprint(cwd, 'prebuild-inputs');
        const nativeDirsReady =
            (!buildAndroid || existsSync(join(cwd, 'android'))) &&
            (!buildIos || existsSync(join(cwd, 'ios')));
        if (cached === fingerprint && nativeDirsReady) {
            log('Prebuild inputs unchanged — skipping');
            return;
        }
    }

    log('Starting prebuild...');

    const rawConfig = await loadConfig(cwd);
    const config = resolveConfig(rawConfig);

    log(`App: ${config.name} v${config.version}`);
    log(`Modules: ${config.modules.length}`);

    // Resolve all asset paths and per-platform overrides up front. Falls back
    // to the bundled placeholders in templates/defaults/ when the user hasn't
    // configured icon/splash/adaptiveIcon — guarantees first prebuild produces
    // a working install.
    const assets = resolveAssets(rawConfig, cwd);

    // Clean if requested
    if (opts.clean) {
        cleanPrebuild(cwd, config, false);
    }

    // ── Android ──────────────────────────────────────────────
    if (buildAndroid && config.platforms.includes('android')) {
        const androidDir = androidProjectRoot(cwd, config);

        // Scaffold if not present; otherwise refresh config-driven files so
        // values like versionCode / orientation propagate without --clean.
        if (!existsSync(androidDir)) {
            scaffoldAndroid(cwd, config);
        } else {
            refreshAndroidManagedFiles(cwd, config);
        }

        // Auto-link
        log('Linking Android modules...');
        // `disabled` entries stay in `config.modules` so auto-discovery knows to
        // skip them too — but they must NOT reach the linker. Filter them out
        // for both the linker input and the "already declared" exclusion set.
        // Scope `disabled` by platform: `{ platforms: ['ios'], disabled: true }`
        // means "skip iOS linking" — auto-discovery should still pick the package
        // up on Android.
        const androidModules = modulesForPlatform(config, 'android');
        const configModulePackages = androidModules.filter((m) => !m.disabled).map((m) => m.package);
        const disabledPackages = androidModules.filter((m) => m.disabled).map((m) => m.package);
        const discoveredPackages = await discoverSigxPackages(
            cwd,
            [...configModulePackages, ...disabledPackages],
            config.excludeModules,
        );
        const allPackages = [...configModulePackages, ...discoveredPackages];
        if (discoveredPackages.length > 0) {
            log(`Auto-discovered (Android): ${discoveredPackages.join(', ')}`);
        }

        const manifests = await loadManifests(allPackages, cwd);
        const result = linkAndroid(config, manifests);

        // Write generated code
        writeAndroidRegistry(cwd, config, result.registryCode);
        writeAndroidLifecyclePublishers(cwd, config, result.lifecycleCode);
        writeAndroidActivityHooks(cwd, config, result.activityHooksCode);
        injectGradleDependencies(cwd, config, result.gradleDependencies, result.debugGradleDependencies);
        injectAndroidPermissions(cwd, config, result.permissions);

        // App-shell assets (icons, splash, manifest meta).
        await generateAndroidIcons(cwd, assets.android);
        await generateAndroidAdaptiveIcon(cwd, assets.android);
        await generateAndroidSplash(cwd, assets.android);
        applyAndroidManifestMeta(cwd, assets.android);
        applyAndroidGradleMeta(cwd, config);

        // Copy dev-client sources if found
        if (result.devClient) {
            copyDevClientSources(cwd, config, result.devClient);
            checkDevClientVersion(cwd, result.devClient.packageName);
            log(`Android: dev-client linked (${result.devClient.initClass})`);
        }

        // Copy non-dev-client native sources from each linked module package
        // into the consumer's Kotlin source tree. Without this step, the
        // generated registry references classes that don't physically exist
        // in the build (the Kotlin sources live in the package, not here).
        copyAndroidModuleSources(cwd, config, manifests);

        log(`Android: linked ${result.linkedModules.length} modules`);
        if (result.linkedModules.length > 0) {
            log(`  Modules: ${result.linkedModules.join(', ')}`);
        }
        if (result.linkedLifecyclePublishers.length > 0) {
            log(`Android: linked ${result.linkedLifecyclePublishers.length} lifecycle publishers`);
            log(`  Publishers: ${result.linkedLifecyclePublishers.join(', ')}`);
        }
        if (result.linkedActivityHooks.length > 0) {
            log(`Android: linked ${result.linkedActivityHooks.length} activity hooks`);
            log(`  Hooks: ${result.linkedActivityHooks.join(', ')}`);
        }
        warnUnlinkedModules(configModulePackages, manifests, 'Android');
    }

    // ── iOS ──────────────────────────────────────────────────
    if (buildIos && config.platforms.includes('ios')) {
        const iosDir = iosProjectRoot(cwd, config);

        // Scaffold if not present, refresh managed files otherwise. Always
        // refresh so dev-client integration glue and config-driven Info.plist
        // values track the installed CLI.
        if (!existsSync(iosDir)) {
            scaffoldIos(cwd, config);
        } else {
            refreshIosManagedFiles(cwd, config);
        }

        // Auto-link
        log('Linking iOS modules...');
        const iosModules = modulesForPlatform(config, 'ios');
        const configModulePackagesIos = iosModules.filter((m) => !m.disabled).map((m) => m.package);
        const disabledPackagesIos = iosModules.filter((m) => m.disabled).map((m) => m.package);
        const discoveredPackagesIos = await discoverSigxPackages(
            cwd,
            [...configModulePackagesIos, ...disabledPackagesIos],
            config.excludeModules,
        );
        const allPackagesIos = [...configModulePackagesIos, ...discoveredPackagesIos];
        if (discoveredPackagesIos.length > 0) {
            log(`Auto-discovered (iOS): ${discoveredPackagesIos.join(', ')}`);
        }

        const manifests = await loadManifests(allPackagesIos, cwd);
        const result = linkIos(config, manifests);

        // Write generated code
        writeIosRegistry(cwd, config, result.registryCode);
        writeIosLifecyclePublishers(cwd, config, result.lifecycleCode);
        writeIosAppDelegateHooks(cwd, config, result.appDelegateHooksCode);
        injectPodfileEntries(cwd, config, result.podfileEntries);
        injectDebugPodfileEntries(cwd, config, result.debugPodfileEntries);
        injectInfoPlistDescriptions(cwd, config, result.usageDescriptions);

        // App-shell assets (icons, splash, plist meta).
        await generateIosIcon(cwd, config, assets.ios);
        await generateIosSplash(cwd, config, assets.ios);
        applyIosPlistMeta(cwd, config, assets.ios);

        // Copy dev-client sources if found
        if (result.devClient) {
            copyDevClientSourcesIos(cwd, config, result.devClient);
            checkDevClientVersion(cwd, result.devClient.packageName);
            log(`iOS: dev-client linked (${result.devClient.initClass})`);
        }

        // Copy non-dev-client native sources from each linked module package
        // into the consumer's iOS Generated/ directory and register them in
        // the Xcode project. Without this step the generated registry
        // references Swift classes that don't exist in the build.
        copyIosModuleSources(cwd, config, manifests);

        // The pbxproj permanently references `main.lynx.bundle` in the Copy
        // Bundle Resources phase so release builds pick it up. Dev builds
        // never load from the asset (ContentView hits the HTTP URL instead),
        // but xcodebuild still fails if the file is missing — seed an empty
        // placeholder on first prebuild. ContentView treats a 0-byte bundle
        // as "missing" so sandbox apps still hit DevHomeScreen.
        const bundlePath = join(iosSourceRoot(cwd, config), 'main.lynx.bundle');
        if (!existsSync(bundlePath)) {
            writeFileSync(bundlePath, '');
            log('iOS: seeded empty main.lynx.bundle placeholder (overwritten by run:ios --release)');
        }

        log(`iOS: linked ${result.linkedModules.length} modules`);
        if (result.linkedModules.length > 0) {
            log(`  Modules: ${result.linkedModules.join(', ')}`);
        }
        if (result.linkedLifecyclePublishers.length > 0) {
            log(`iOS: linked ${result.linkedLifecyclePublishers.length} lifecycle publishers`);
            log(`  Publishers: ${result.linkedLifecyclePublishers.join(', ')}`);
        }
        if (result.linkedAppDelegateHooks.length > 0) {
            log(`iOS: linked ${result.linkedAppDelegateHooks.length} AppDelegate hooks`);
            log(`  Hooks: ${result.linkedAppDelegateHooks.join(', ')}`);
        }
        warnUnlinkedModules(configModulePackagesIos, manifests, 'iOS');
    }

    // Record what we just successfully built from so the next runPrebuild
    // can short-circuit when inputs haven't changed.
    const fingerprint = fingerprintPrebuildInputs(cwd, { android: buildAndroid, ios: buildIos });
    writeCachedFingerprint(cwd, 'prebuild-inputs', fingerprint);

    log('Prebuild complete!');
}

/**
 * If any module the user declared in `signalx.config.ts:modules` didn't
 * produce a manifest, print a prominent warning. This turns the previously
 * silent "0 of N modules linked" failure into something the user can act on.
 */
function warnUnlinkedModules(
    declared: string[],
    manifests: ModuleManifest[],
    platform: string,
): void {
    const linkedPkgs = new Set(manifests.map((m) => m.package));
    const missing = declared.filter((pkg) => !linkedPkgs.has(pkg));
    if (missing.length === 0) return;
    log(`\x1b[33m!\x1b[0m ${platform}: ${missing.length} of ${declared.length} declared module(s) did not link:`);
    for (const pkg of missing) {
        log(`    - ${pkg}`);
    }
    log(`\x1b[33m!\x1b[0m The generated module registry will not expose these modules at runtime.`);
}
