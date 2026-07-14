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
import { createHash } from 'node:crypto';
import { join, dirname, relative, extname, basename, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { resolveConfig, modulesForPlatform, resolveAssets } from './config/index.js';
import { writeFileIfChanged, copyFileIfChanged } from './util/idempotent-write.js';
import { embedBundle } from './util/embed-bundle.js';
import {
    combineHash, getCliVersion, walkFiles,
    readCachedFingerprint, writeCachedFingerprint,
} from './util/build-fingerprint.js';
import { findLockfile } from './util/package-manager.js';
import { computeRuntimeVersion, runtimeVersionsSidecarPath, writeRuntimeVersionsSidecar } from './util/runtime-version.js';
import {
    iosProjectRoot, iosSourceRoot, iosXcodeProjPath, iosPodfilePath, iosInfoPlistPath,
    androidProjectRoot, androidKotlinRoot,
    androidManifestPath, androidDebugManifestPath, androidBuildGradlePath,
    androidDirName, iosDirName,
} from './config/paths.js';
import { linkAndroid } from './autolink/android.js';
import { linkIos } from './autolink/ios.js';
import { validateManifest } from './manifest.js';
import { generateIosIcon, generateAndroidIcons, generateAndroidAdaptiveIcon, generateAndroidNotificationIcon } from './assets/icons.js';
import { generateIosSplash, generateAndroidSplash } from './assets/splash.js';
import { applyIosPlistMeta, applyAndroidManifestMeta, applyAndroidGradleMeta } from './assets/manifest.js';
import type { LynxConfig, PlistValue } from './config/index.js';
import type { ResolvedConfig } from './config/parser.js';
import type { ModuleManifest } from './manifest.js';
import type { AndroidLinkResult, DevClientInfo } from './autolink/android.js';
import type { IosLinkResult, IosDevClientInfo } from './autolink/ios.js';

export interface PrebuildOptions {
    android?: boolean;
    ios?: boolean;
    clean?: boolean;
    cwd?: string;
    /**
     * Copy the built `dist/main.lynx.bundle` into the native project(s) so an
     * external release pipeline (fastlane, plain `xcodebuild archive`,
     * `gradle bundleRelease`, …) ships the real bundle. Requires a prior
     * `sigx build`. Off by default — plain prebuild keeps seeding the empty
     * placeholder so dev/sandbox builds fall through to the dev server. (#521)
     */
    embedBundle?: boolean;
    /**
     * Build variant to render (issue #530). Deep-merges the named variant from
     * `signalx.config.ts` onto the base config and renders into its own
     * `android-<variant>/` / `ios-<variant>/` output dir. Undefined → the base
     * (production) identity into `android/` / `ios/`.
     */
    variant?: string;
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

// Windows scripts must keep CRLF; every other generated text file must be LF.
const CRLF_EXTENSIONS = new Set(['.bat', '.cmd']);

/**
 * Force deterministic line endings on generated text so the output never
 * depends on the template's checked-out bytes or the publisher's autocrlf.
 * `gradlew` is a shell script executed on macOS/Linux: a stray CR turns its
 * `#!/bin/sh` shebang into `#!/bin/sh^M` → `bad interpreter` and the Android
 * build dies immediately. So POSIX scripts/config get LF and Windows `.bat`
 * scripts get CRLF, regardless of host OS. See issue #594.
 */
function normalizeLineEndings(content: string, fileName: string): string {
    // Collapse every terminator (CRLF and lone CR) to LF first so the result is
    // deterministic regardless of how the template was edited or checked out.
    const lf = content.replace(/\r\n?/g, '\n');
    return CRLF_EXTENSIONS.has(extname(fileName).toLowerCase())
        ? lf.replace(/\n/g, '\r\n')
        : lf;
}

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
                content = normalizeLineEndings(content, entry.name);
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
    // Transitively-discovered packages (e.g. @sigx/lynx-core pulled in by a
    // module's own deps) aren't resolvable from the app root under pnpm's
    // strict node_modules — the index resolves them from their dependent.
    const index = buildManifestIndex(cwd);
    const manifests: ModuleManifest[] = [];

    // lynx-core's activity hook must dispatch before any other hook in the
    // same lifecycle callback (GeneratedActivityHooks calls hooks in manifest
    // order), so consumers of SigxActivityHolder always see a populated
    // holder. Discovery already sorts it first, but config-declared modules
    // (`modules:` in signalx.config) are prepended to the discovered list —
    // enforce the invariant here regardless of how the list was assembled.
    const ordered = [...modulePackages].sort((a, b) =>
        a === '@sigx/lynx-core' ? -1 : b === '@sigx/lynx-core' ? 1 : 0);

    for (const pkg of ordered) {
        try {
            const manifestPath = index.get(pkg) ?? require.resolve(`${pkg}/signalx-module.json`);
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
    const androidDir = androidProjectRoot(cwd, config);
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
 * Heal the Gradle wrapper's line endings on every prebuild. `gradlew` is a
 * scaffold-once file (not in MANAGED_ANDROID_FILES), so a project generated by
 * an older CLI — or checked out with autocrlf — keeps its CRLF wrapper forever,
 * and a CRLF shebang (`#!/bin/sh^M`) breaks the Android build on macOS/Linux.
 * Rewriting it to LF here is idempotent and cheap. See issue #594.
 */
export function ensureGradlewLf(cwd: string, config: ResolvedConfig): void {
    const gradlew = join(androidProjectRoot(cwd, config), 'gradlew');
    if (!existsSync(gradlew)) return;
    const content = readFileSync(gradlew, 'utf-8');
    const lf = normalizeLineEndings(content, 'gradlew');
    if (lf !== content) {
        writeFileSync(gradlew, lf);
        log('Android: normalized gradlew line endings to LF');
    }
    chmodSync(gradlew, 0o755);
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
 * Write the generated behaviors attacher Kotlin file. Lives alongside the
 * other generated Android files so MainActivity (production path) and
 * `DevLynxScreen` (dev path) can both call `GeneratedBehaviors.attachAll`
 * with no extra import.
 */
export function writeAndroidBehaviors(cwd: string, config: ResolvedConfig, behaviorsCode: string): void {
    const applicationId = resolveApplicationId(config);
    const packagePath = packageToPath(applicationId);
    const dir = join(androidKotlinRoot(cwd, config), packagePath);
    const file = join(dir, 'GeneratedBehaviors.kt');

    const code = behaviorsCode.replace(
        /^package .*$/m,
        `package ${applicationId}`
    );

    mkdirSync(dir, { recursive: true });
    writeFileIfChanged(file, code);
    log(`Android: wrote GeneratedBehaviors.kt`);
}

/**
 * Android runtime-version manifest meta-data key. Copied module sources
 * can't reference the app's `BuildConfig` (its package isn't known at
 * module-authoring time), so the fingerprint travels as `<meta-data>` and
 * `@sigx/lynx-updates` reads it via PackageManager — same mechanism as the
 * Maps API key.
 */
export const ANDROID_RUNTIME_VERSION_META_KEY = 'com.sigx.updates.RUNTIME_VERSION';

/**
 * Android manifest meta-data key carrying the active build variant name
 * (issue #530). Mirrors {@link ANDROID_RUNTIME_VERSION_META_KEY}'s mechanism so
 * native code can read the variant without an app-package-scoped BuildConfig.
 */
export const ANDROID_VARIANT_META_KEY = 'com.sigx.VARIANT';

/**
 * Inject the runtime-version fingerprint into the release Info.plist as
 * `SigxRuntimeVersion`. Must run BEFORE `writeIosDebugInfoPlist`, which
 * snapshots the final release plist for the Debug configuration.
 */
export function injectIosRuntimeVersion(cwd: string, config: ResolvedConfig, runtimeVersion: string): void {
    const plistFile = iosInfoPlistPath(cwd, config);
    if (!existsSync(plistFile)) return;
    let content = readFileSync(plistFile, 'utf-8');
    content = content.replace(
        '    <!-- {{RUNTIME_VERSION}} -->',
        `    <key>SigxRuntimeVersion</key>\n    <string>${runtimeVersion}</string>`
    );
    writeFileIfChanged(plistFile, content);
    log(`iOS: runtime version ${runtimeVersion}`);
}

/**
 * Write the generated startup bundle resolver Kotlin file. Lives alongside
 * the other generated Android files so MainActivity can call
 * `GeneratedBundleResolver.resolveStartupBundlePath(this)` with no import.
 */
export function writeAndroidBundleResolver(cwd: string, config: ResolvedConfig, resolverCode: string): void {
    const applicationId = resolveApplicationId(config);
    const packagePath = packageToPath(applicationId);
    const dir = join(androidKotlinRoot(cwd, config), packagePath);
    const file = join(dir, 'GeneratedBundleResolver.kt');

    const code = resolverCode.replace(
        /^package .*$/m,
        `package ${applicationId}`
    );

    mkdirSync(dir, { recursive: true });
    writeFileIfChanged(file, code);
    log(`Android: wrote GeneratedBundleResolver.kt`);
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
 * Inject auto-linked Gradle plugins into the app `plugins {}` block. Each
 * entry becomes an `id("<id>") version "<version>"` line at the
 * `// {{GRADLE_PLUGINS}}` marker. The marker only exists on a freshly
 * regenerated `build.gradle.kts` (a managed file), so re-running is
 * idempotent — once the marker is consumed the function no-ops.
 *
 * `id`/`version` are spliced raw into a build script, so both are validated
 * against a strict character format first (same hardening rationale as
 * `applyIosSigningSettings`): a crafted manifest can't smuggle arbitrary
 * Kotlin into the plugins block. This is injection-hardening, NOT a trust
 * allowlist — a well-formed id from a linked module is applied as-is, the
 * same trust model as `android.dependencies` (Gradle coordinates can carry
 * build logic) and `sourceDir` (arbitrary native code compiled into the app).
 */
export function injectGradlePlugins(
    cwd: string,
    config: ResolvedConfig,
    plugins: import('./manifest.js').AndroidGradlePluginEntry[],
): void {
    const gradleFile = androidBuildGradlePath(cwd, config);
    if (!existsSync(gradleFile)) return;

    let content = readFileSync(gradleFile, 'utf-8');
    const marker = '    // {{GRADLE_PLUGINS}}';
    if (!content.includes(marker)) return;

    for (const plugin of plugins) {
        if (!/^[a-z][a-z0-9.-]*$/.test(plugin.id)) {
            throw new Error(
                `Invalid Gradle plugin id "${plugin.id}" — expected a reverse-DNS ` +
                `plugin id (lowercase letters, digits, '.', '-').`,
            );
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9.+_-]*$/.test(plugin.version)) {
            throw new Error(
                `Invalid Gradle plugin version "${plugin.version}" for "${plugin.id}".`,
            );
        }
    }

    const replacement = plugins.length > 0
        ? `    // Auto-linked module Gradle plugins\n${
            plugins.map((p) => `    id("${p.id}") version "${p.version}"`).join('\n')
          }`
        : '    // (no auto-linked Gradle plugins)';
    content = content.replace(marker, replacement);
    writeFileIfChanged(gradleFile, content);
    if (plugins.length > 0) {
        log(`Android: injected ${plugins.length} Gradle plugin(s) (${plugins.map((p) => p.id).join(', ')})`);
    }
}

/** FCM messaging-service intent-filter action — marks a module as needing FCM. */
const FCM_MESSAGING_EVENT_ACTION = 'com.google.firebase.MESSAGING_EVENT';

/**
 * Copy the configured Firebase `google-services.json` into
 * `android/app/google-services.json` so it survives `android/` regeneration.
 * The `com.google.gms.google-services` plugin reads it at build time to emit
 * the `google_app_id` / `gcm_defaultSenderId` resources that auto-initialize
 * the default `FirebaseApp` — without it FCM token retrieval fails.
 *
 * When `android.googleServicesFile` is unset but a linked module registers an
 * FCM messaging service (the `MESSAGING_EVENT` action), warn — mirrors the
 * Maps API-key `metaDataWarnings` nudge — so remote push doesn't silently
 * fail to initialize.
 */
export function copyGoogleServicesFile(
    cwd: string,
    config: ResolvedConfig,
    services: import('./manifest.js').AndroidServiceEntry[],
): void {
    const configured = config.android.googleServicesFile?.trim();
    const fcmLinked = services.some((s) => s.actions?.includes(FCM_MESSAGING_EVENT_ACTION));

    if (!configured) {
        if (fcmLinked) {
            log(
                `\x1b[33m!\x1b[0m An FCM messaging service is linked but ` +
                `\`android.googleServicesFile\` is not set — remote push won't ` +
                `initialize. Point it at your Firebase google-services.json in signalx.config.ts.`,
            );
        }
        return;
    }

    const srcPath = isAbsolute(configured) ? configured : join(cwd, configured);
    if (!existsSync(srcPath)) {
        throw new Error(
            `android.googleServicesFile points at "${configured}" but no file exists at ` +
            `${srcPath}. Set it to your Firebase google-services.json path (relative to the project root).`,
        );
    }

    const destPath = join(androidProjectRoot(cwd, config), 'app', 'google-services.json');
    mkdirSync(dirname(destPath), { recursive: true });
    if (writeFileIfChanged(destPath, readFileSync(srcPath, 'utf-8'))) {
        log(`Android: copied google-services.json from ${configured}`);
    }
}

/**
 * Marker identifying `src/debug/AndroidManifest.xml` as prebuild-owned.
 * A debug manifest without it is user-managed — never overwrite or delete it.
 */
const DEBUG_MANIFEST_MARKER = 'Auto-generated by sigx prebuild';

/**
 * Write (or remove) the debug-variant AndroidManifest overlay holding
 * permissions contributed by `debugOnly` modules — e.g. CAMERA for the
 * dev-client QR scanner. The manifest merger folds it into debug builds
 * only, so release APKs don't declare permissions no release code uses.
 *
 * Only touches the file when prebuild owns it (marker comment present);
 * a hand-written debug manifest is left alone with a warning.
 */
export function writeAndroidDebugManifest(cwd: string, config: ResolvedConfig, debugPermissions: string[]): void {
    const manifestFile = androidDebugManifestPath(cwd, config);

    const existing = existsSync(manifestFile) ? readFileSync(manifestFile, 'utf-8') : null;
    if (existing !== null && !existing.includes(DEBUG_MANIFEST_MARKER)) {
        if (debugPermissions.length > 0) {
            log(
                `\x1b[33m!\x1b[0m src/debug/AndroidManifest.xml is user-managed — not touching it. ` +
                `Make sure it declares: ${debugPermissions.join(', ')}`,
            );
        }
        return;
    }

    if (debugPermissions.length === 0) {
        if (existing !== null) {
            unlinkSync(manifestFile);
            log('Android: removed empty src/debug/AndroidManifest.xml');
        }
        return;
    }

    const permLines = debugPermissions
        .map((p) => `    <uses-permission android:name="${p}" />`)
        .join('\n');
    const content = `<?xml version="1.0" encoding="utf-8"?>
<!-- ${DEBUG_MANIFEST_MARKER} — do not edit manually.
     Debug-only permissions contributed by debugOnly modules; merged into
     debug builds by the Android manifest merger, absent from release. -->
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
${permLines}
</manifest>
`;
    mkdirSync(dirname(manifestFile), { recursive: true });
    writeFileIfChanged(manifestFile, content);
    log(`Android: wrote src/debug/AndroidManifest.xml (${debugPermissions.length} debug-only permission(s))`);
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
 * Inject `<uses-feature>` declarations into AndroidManifest.xml. Entries come
 * from `android.features` in the app config plus any contributed by linked
 * modules (aggregated and de-duped by `linkAndroid`). `required` defaults to
 * false — the common case is undoing the Play Store's "permission implies
 * required hardware" inference.
 */
export function injectAndroidFeatures(
    cwd: string,
    config: ResolvedConfig,
    features: import('./manifest.js').AndroidFeatureEntry[],
): void {
    if (features.length === 0) return;

    const manifestFile = androidManifestPath(cwd, config);
    if (!existsSync(manifestFile)) return;

    let content = readFileSync(manifestFile, 'utf-8');
    const featureLines = features
        .map((f) => `    <uses-feature android:name="${escapeXmlAttr(f.name)}" android:required="${f.required === true}" />`)
        .join('\n');
    content = content.replace(
        '    <!-- {{FEATURES}} -->',
        `    <!-- Feature declarations (app config + auto-linked modules) -->\n${featureLines}`
    );
    if (writeFileIfChanged(manifestFile, content)) {
        log(`Android: injected ${features.length} uses-feature declaration(s)`);
    }
}

/**
 * Copy dev-client Kotlin sources into the Android project.
 *
 * Resolves the dev-client package from node_modules and copies its
 * `sourceDir` into the app's **debug** Kotlin source set. The dev client is
 * debug-only — its dependencies (devtool, CameraX, ML Kit, …) are injected as
 * `debugImplementation`, so its sources must not land in `src/main` or
 * `:app:compileReleaseKotlin` fails with unresolved references (#172).
 *
 * Template code references `com.sigx.devclient.*` unconditionally (runtime-
 * gated by `BuildConfig.DEBUG`), so the package's `releaseStubsDir` — no-op
 * mirrors of the referenced classes — is copied into the **release** source
 * set to keep release builds compiling without any dev-client code or deps.
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

    // Earlier CLI versions copied the dev-client into src/main/kotlin. Remove
    // that copy so upgraded projects don't end up with duplicate classes
    // (main + debug source sets both compile into the debug variant).
    const staleMainCopy = join(androidKotlinRoot(cwd, config), 'com', 'sigx', 'devclient');
    if (existsSync(staleMainCopy)) {
        rmSync(staleMainCopy, { recursive: true, force: true });
        log('Android: removed stale dev-client copy from src/main/kotlin');
    }

    copyDirRecursive(sourceRoot, androidKotlinRoot(cwd, config, 'debug'));
    log(`Android: copied dev-client sources from ${devClientInfo.packageName} (debug source set)`);

    // With the real sources confined to src/debug, the release stubs are
    // what keeps `:app:compileReleaseKotlin` compiling — a missing stub dir
    // means a dev-client older than the CLI. Fail fast with the fix rather
    // than letting release builds die later on "Unresolved reference".
    const stubsRoot = devClientInfo.releaseStubsDir
        ? join(pkgDir, devClientInfo.releaseStubsDir)
        : null;
    if (stubsRoot === null || !existsSync(stubsRoot)) {
        throw new Error(
            `${devClientInfo.packageName} ships no release stubs ` +
            (stubsRoot === null
                ? '(no "releaseStubsDir" in its signalx-module.json)'
                : `(declared dir missing: ${stubsRoot})`) +
            ` — release builds would fail to compile. ` +
            `Update ${devClientInfo.packageName} to match @sigx/lynx-cli (lockstep versions).`,
        );
    }
    copyDirRecursive(stubsRoot, androidKotlinRoot(cwd, config, 'release'));
    log('Android: copied dev-client release stubs (release source set)');
}

/**
 * Copy each linked module's Android Kotlin sources from its package's
 * `sourceDir` into the consumer's Kotlin source tree. Sources retain their
 * own package declarations (each module declares `package com.sigx.<x>`),
 * so they land in the right Kotlin package automatically — we just need
 * the file bytes present in the right source set: `app/src/main/kotlin/`
 * normally, `app/src/debug/kotlin/` for `debugOnly` modules (whose deps
 * are debugImplementation and must stay off the release compile classpath).
 *
 * Mirrors `copyDevClientSources` but iterates over every manifest with a
 * non-dev-client `android.sourceDir`. Idempotent — overwrites the destination.
 */
export function copyAndroidModuleSources(cwd: string, config: ResolvedConfig, manifests: ModuleManifest[]): void {
    const require = createRequire(join(cwd, 'package.json'));
    const index = buildManifestIndex(cwd);

    let copiedPackages = 0;
    for (const manifest of manifests) {
        if (manifest.type === 'dev-client') continue; // dev-client has its own copy path
        const android = manifest.android;
        if (!android?.sourceDir) continue;
        // debugOnly modules' deps are debugImplementation, so their sources
        // must stay out of src/main or release compiles break (#172).
        const destRoot = androidKotlinRoot(cwd, config, android.debugOnly ? 'debug' : 'main');

        let pkgDir: string;
        try {
            // Resolve via signalx-module.json (which we know is exported — it
            // had to be for autolink to find the manifest in the first place)
            // rather than package.json (which packages with `exports` fields
            // don't always expose). Index first: transitively-discovered
            // packages don't resolve from the app root under pnpm.
            const manifestPath = index.get(manifest.package)
                ?? require.resolve(`${manifest.package}/signalx-module.json`);
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
    const index = buildManifestIndex(cwd);
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
            // isn't always exposed when an `exports` field exists. Index
            // first: transitively-discovered packages don't resolve from the
            // app root under pnpm.
            const manifestPath = index.get(manifest.package)
                ?? require.resolve(`${manifest.package}/signalx-module.json`);
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
 * Build an index of every resolvable sigx module manifest reachable from the
 * consumer app: `package name → absolute path of its signalx-module.json`.
 *
 * Starts from the app's direct dependencies (and devDependencies, so packages
 * scoped to dev like @sigx/lynx-dev-client still get indexed) and walks each
 * found module's own runtime `dependencies` the same way (breadth-first), so
 * a native module that depends on another native package — e.g. every
 * module's dependency on `@sigx/lynx-core`, which ships the shared Activity
 * holder — is indexed without the app declaring it directly. Resolution for
 * transitive candidates is anchored at the *dependent* package's own
 * location, which matters under pnpm's strict (non-hoisted) node_modules:
 * the app's resolver cannot see its transitive dependencies at all.
 *
 * The presence of `signalx-module.json` IS the "this is a Lynx native module"
 * marker — packages without it (icons, navigation, etc.) are silently ignored.
 */
export function buildManifestIndex(cwd: string): Map<string, string> {
    const index = new Map<string, string>();

    let pkgJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
        pkgJson = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    } catch {
        // No package.json — nothing to scan.
        return index;
    }

    const visited = new Set<string>();
    const appRequire = createRequire(join(cwd, 'package.json'));
    const queue: Array<{ pkg: string; resolve: NodeJS.RequireResolve }> = [];
    for (const pkg of new Set([
        ...Object.keys(pkgJson.dependencies ?? {}),
        ...Object.keys(pkgJson.devDependencies ?? {}),
    ])) {
        queue.push({ pkg, resolve: appRequire.resolve });
    }

    // Index pointer rather than queue.shift() — shift() reindexes the array
    // on every pop, turning the BFS O(n²) on large dependency graphs.
    for (let head = 0; head < queue.length; head++) {
        const { pkg, resolve } = queue[head];
        if (visited.has(pkg)) continue;
        visited.add(pkg);

        let manifestPath: string;
        try {
            manifestPath = resolve(`${pkg}/signalx-module.json`);
        } catch {
            // Either MODULE_NOT_FOUND (package isn't a Lynx module / not installed)
            // or ERR_PACKAGE_PATH_NOT_EXPORTED (package's `exports` field doesn't
            // list this subpath — fires for every non-Lynx package that uses
            // exports). Both are expected for the vast majority of deps; surfacing
            // either as a warning would drown the user in false positives.
            continue;
        }
        index.set(pkg, manifestPath);

        // Walk this module's own runtime dependencies (devDependencies aren't
        // shipped). The manifest always sits at the package root, so its
        // sibling package.json is readable from disk even when the package's
        // `exports` field doesn't expose it — and anchoring the resolver there
        // is what makes transitive-only packages resolvable under pnpm.
        const modPkgJsonPath = join(dirname(manifestPath), 'package.json');
        let modPkg: { dependencies?: Record<string, string> };
        try {
            modPkg = JSON.parse(readFileSync(modPkgJsonPath, 'utf-8'));
        } catch {
            continue;
        }
        const modResolve = createRequire(modPkgJsonPath).resolve;
        for (const dep of Object.keys(modPkg.dependencies ?? {})) {
            if (!visited.has(dep)) {
                queue.push({ pkg: dep, resolve: modResolve });
            }
        }
    }

    return index;
}

/**
 * Auto-discover sigx native module packages installed in the consumer app —
 * direct dependencies plus their transitive module dependencies (see
 * [buildManifestIndex]). Skips packages already in `existingPackages` (i.e.
 * declared via `modules:` in the config) and anything listed in
 * `excludeModules` (which applies to transitive finds too).
 */
export async function discoverSigxPackages(
    cwd: string,
    existingPackages: string[],
    excludeModules: string[] = [],
): Promise<string[]> {
    const existing = new Set(existingPackages);
    const excluded = new Set(excludeModules);
    const discovered = [...buildManifestIndex(cwd).keys()]
        .filter((pkg) => !existing.has(pkg) && !excluded.has(pkg));

    // Excluding lynx-core silently breaks every module that reads the shared
    // SigxActivityHolder — allow it (pre-1.0, user's choice) but say so.
    if (excluded.has('@sigx/lynx-core') && (discovered.length > 0 || existing.size > 0)) {
        log('⚠ @sigx/lynx-core is excluded — modules relying on its shared native helpers (biometric, pickers, …) will not find an Activity.');
    }

    // The lynx-core activity hook must run before other modules' hooks within
    // the same lifecycle callback, so consumers of SigxActivityHolder see a
    // populated holder. GeneratedActivityHooks dispatches in manifest order.
    discovered.sort((a, b) =>
        a === '@sigx/lynx-core' ? -1 : b === '@sigx/lynx-core' ? 1 : 0);

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
 *
 * `gradle/libs.versions.toml` is managed for the same reason: the managed
 * `build.gradle.kts` references its aliases (e.g. `libs.androidx.fragment.ktx`),
 * so the version catalog must travel with it. If it were scaffold-once, a
 * template change that adds a new alias to both files would leave existing
 * projects with a refreshed `build.gradle.kts` referencing an alias their stale
 * catalog lacks → `Unresolved reference`. The catalog holds only framework
 * version pins (module deps inject into `build.gradle.kts` directly, not here).
 */
const MANAGED_ANDROID_FILES = [
    'app/src/main/AndroidManifest.xml',
    'app/src/main/res/values/themes.xml',
    'app/src/main/res/xml/file_provider_paths.xml',
    'app/src/main/res/xml/network_security_config.xml',
    'app/src/debug/res/xml/network_security_config.xml',
    'app/build.gradle.kts',
    'gradle/libs.versions.toml',
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
        const destPath = join(androidProjectRoot(cwd, config), resolvedRel);
        if (!existsSync(srcPath)) continue;
        const content = normalizeLineEndings(
            substituteVars(readFileSync(srcPath, 'utf-8'), vars),
            resolvedRel,
        );
        mkdirSync(dirname(destPath), { recursive: true });
        if (writeFileIfChanged(destPath, content)) refreshed++;
    }
    if (refreshed > 0) log(`Android: refreshed ${refreshed} managed config files`);
}

/**
 * Scaffold the iOS project from the template.
 */
export function scaffoldIos(cwd: string, config: ResolvedConfig): void {
    const iosDir = iosProjectRoot(cwd, config);
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
    const destAppDir = iosSourceRoot(cwd, config);

    let refreshed = 0;
    for (const rel of MANAGED_IOS_FILES) {
        const srcPath = join(templateAppDir, rel);
        const destPath = join(destAppDir, rel);
        if (!existsSync(srcPath)) continue;
        const content = normalizeLineEndings(
            substituteVars(readFileSync(srcPath, 'utf-8'), vars),
            rel,
        );
        mkdirSync(dirname(destPath), { recursive: true });
        if (writeFileIfChanged(destPath, content)) refreshed++;
    }

    // Refresh Podfile. This carries Lynx SDK pod declarations that must track
    // the installed SDK version. {{POD_ENTRIES}} / {{DEBUG_POD_ENTRIES}}
    // placeholders are then re-injected by the autolinker.
    const podfileSrc = join(templateRootDir, 'Podfile');
    const podfileDest = iosPodfilePath(cwd, config);
    if (existsSync(podfileSrc)) {
        const content = normalizeLineEndings(
            substituteVars(readFileSync(podfileSrc, 'utf-8'), vars),
            'Podfile',
        );
        if (writeFileIfChanged(podfileDest, content)) refreshed++;
    }

    if (refreshed > 0) {
        log(`iOS: refreshed ${refreshed} managed integration files`);
    }
}

/**
 * Write the shared Xcode scheme for the app target.
 *
 * `xcodebuild -scheme` and fastlane `gym` require a *shared* scheme
 * (`xcshareddata/xcschemes/<App>.xcscheme`). Opening the project in the
 * Xcode GUI auto-creates a private *user* scheme, but a headless CI runner
 * never gets one — so without this the generated project can't be archived
 * for TestFlight/App Store (#174).
 *
 * Runs every prebuild (idempotent via writeFileIfChanged). The app target's
 * UUID is read from the project's own pbxproj — identical to the template
 * placeholder for scaffolded projects, but follows along if the project was
 * hand-curated.
 */
export function writeIosSharedScheme(cwd: string, config: ResolvedConfig): void {
    const xcodeproj = iosXcodeProjPath(cwd, config);
    const pbxprojPath = join(xcodeproj, 'project.pbxproj');
    if (!existsSync(pbxprojPath)) return;

    const templatePath = join(
        getTemplatesDir(), 'ios',
        '__AppName__.xcodeproj', 'xcshareddata', 'xcschemes', '__AppName__.xcscheme',
    );
    if (!existsSync(templatePath)) return;

    // Prefer the native target whose name matches the app — hand-curated
    // projects can carry extra targets (tests, extensions) and scaffolded
    // ones have exactly one. Fall back to the first native target so legacy
    // projects with a renamed app target still get a working scheme.
    // UUIDs are 16 hex chars in our template's placeholder ids and 24 in
    // Xcode-generated (and our fileUUID-generated) ids — accept both.
    const pbx = readFileSync(pbxprojPath, 'utf-8');
    const escapedName = config.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const byName = pbx.match(new RegExp(
        `([A-F0-9]{16,24})\\s+/\\* ${escapedName} \\*/\\s*=\\s*\\{\\s*isa = PBXNativeTarget;`,
    ));
    const target = byName ?? pbx.match(/([A-F0-9]{16,24})\s+\/\*[^*]*\*\/\s*=\s*\{\s*isa = PBXNativeTarget;/);
    if (!target) {
        log(
            `\x1b[33m!\x1b[0m Could not find a PBXNativeTarget UUID in ${pbxprojPath} — ` +
            `writing the shared scheme with the template's default target id. ` +
            `If \`xcodebuild -scheme "${config.name}"\` can't find the target, fix the ` +
            `BlueprintIdentifier in the generated .xcscheme to match your app target.`,
        );
    }
    const targetUuid = target?.[1] ?? 'E100000000000001';

    const content = substituteVars(readFileSync(templatePath, 'utf-8'), { appName: config.name })
        .replace(/E100000000000001/g, targetUuid);
    const dest = join(xcodeproj, 'xcshareddata', 'xcschemes', `${config.name}.xcscheme`);
    mkdirSync(dirname(dest), { recursive: true });
    if (writeFileIfChanged(dest, content)) {
        log(`iOS: wrote shared scheme ${config.name}.xcscheme`);
    }
}

/**
 * Apply config-driven signing settings (`ios.developmentTeam`,
 * `ios.codeSignStyle`) to the existing pbxproj. Only rewrites a setting the
 * config actually pins — with both unset this is a no-op, so values set via
 * the Xcode GUI or fastlane's `update_code_signing_settings` survive
 * prebuild untouched.
 */
export function applyIosSigningSettings(cwd: string, config: ResolvedConfig): void {
    const team = config.ios.developmentTeam?.trim();
    const style = config.ios.codeSignStyle;
    if (!team && !style) return;

    // Both values are spliced into project.pbxproj as raw build-setting
    // values — validate at runtime (the config file is plain JS/TS, so the
    // schema's union type guarantees nothing) so a typo'd team or a crafted
    // value can't corrupt the project or smuggle in extra build settings.
    if (team && !/^[A-Za-z0-9]{10}$/.test(team)) {
        throw new Error(
            `ios.developmentTeam must be a 10-character alphanumeric Apple Team ID ` +
            `(e.g. "AB12CD34EF"), got: "${team}"`,
        );
    }
    if (style && style !== 'Automatic' && style !== 'Manual') {
        throw new Error(
            `ios.codeSignStyle must be "Automatic" or "Manual", got: "${style}"`,
        );
    }

    const pbxprojPath = join(iosXcodeProjPath(cwd, config), 'project.pbxproj');
    if (!existsSync(pbxprojPath)) return;

    let content = readFileSync(pbxprojPath, 'utf-8');
    if (team) {
        content = content.replace(/DEVELOPMENT_TEAM = [^;]*;/g, `DEVELOPMENT_TEAM = ${team};`);
    }
    if (style) {
        content = content.replace(/CODE_SIGN_STYLE = [^;]*;/g, `CODE_SIGN_STYLE = ${style};`);
    }
    if (writeFileIfChanged(pbxprojPath, content)) {
        const applied = [team && `DEVELOPMENT_TEAM=${team}`, style && `CODE_SIGN_STYLE=${style}`]
            .filter(Boolean).join(', ');
        log(`iOS: applied signing settings (${applied})`);
    }
}

/**
 * Apply `ios.supportsTablet` to the Xcode project's TARGETED_DEVICE_FAMILY
 * (hits both Debug and Release build configurations): `"1,2"` (iPhone +
 * iPad, the scaffold default) when true/unset, `"1"` (iPhone-only) when
 * false. The value is internally derived — no user input is spliced in, so
 * no runtime validation is needed (unlike signing settings).
 */
export function applyIosDeviceFamily(cwd: string, config: ResolvedConfig): void {
    const pbxprojPath = join(iosXcodeProjPath(cwd, config), 'project.pbxproj');
    if (!existsSync(pbxprojPath)) return;

    const family = config.ios.supportsTablet === false ? '1' : '1,2';
    let content = readFileSync(pbxprojPath, 'utf-8');
    content = content.replace(/TARGETED_DEVICE_FAMILY = "[^"]*";/g, `TARGETED_DEVICE_FAMILY = "${family}";`);
    if (writeFileIfChanged(pbxprojPath, content)) {
        log(`iOS: applied device family (TARGETED_DEVICE_FAMILY="${family}")`);
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
 * Write the generated UI component registry. Sibling to the other generated
 * iOS files; `LynxSetupService.initialize` calls
 * `GeneratedComponentRegistry.registerAll(on: config)` before
 * `LynxEnv.prepareConfig` so the shared config carries the registrations.
 */
export function writeIosComponentRegistry(cwd: string, config: ResolvedConfig, registryCode: string): void {
    const file = join(iosSourceRoot(cwd, config), 'GeneratedComponentRegistry.swift');
    mkdirSync(dirname(file), { recursive: true });
    writeFileIfChanged(file, registryCode);
    addFilesToXcodeProject(cwd, config, '', ['GeneratedComponentRegistry.swift']);
    log(`iOS: wrote GeneratedComponentRegistry.swift`);
}

/**
 * Write the generated startup bundle resolver Swift file. Sibling to the
 * other generated iOS files; ContentView resolves it once at init before
 * falling back to the baked bundle resource.
 */
export function writeIosBundleResolver(cwd: string, config: ResolvedConfig, resolverCode: string): void {
    const file = join(iosSourceRoot(cwd, config), 'GeneratedBundleResolver.swift');
    mkdirSync(dirname(file), { recursive: true });
    writeFileIfChanged(file, resolverCode);
    addFilesToXcodeProject(cwd, config, '', ['GeneratedBundleResolver.swift']);
    log(`iOS: wrote GeneratedBundleResolver.swift`);
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
 * Inject UIBackgroundModes entries into Info.plist. De-duped; safe to re-run.
 */
export function injectInfoPlistBackgroundModes(
    cwd: string,
    config: ResolvedConfig,
    modes: string[],
): void {
    const plistFile = iosInfoPlistPath(cwd, config);
    if (!existsSync(plistFile)) return;
    let content = readFileSync(plistFile, 'utf-8');
    const replacement = modes.length > 0
        ? `    <!-- Auto-linked module background modes -->\n` +
          `    <key>UIBackgroundModes</key>\n    <array>\n` +
          modes.map((m) => `        <string>${m}</string>`).join('\n') +
          `\n    </array>`
        : '    <!-- (no auto-linked background modes) -->';
    content = content.replace('    <!-- {{BACKGROUND_MODES}} -->', replacement);
    writeFileIfChanged(plistFile, content);
    if (modes.length > 0) log(`iOS: injected ${modes.length} UIBackgroundModes (${modes.join(', ')})`);
}

/**
 * Inject BGTaskSchedulerPermittedIdentifiers into Info.plist. De-duped; safe
 * to re-run. iOS requires each `BGTaskScheduler` identifier to be listed
 * here BEFORE the app is signed — otherwise `BGTaskScheduler.register(...)`
 * silently fails to fire at runtime.
 */
export function injectInfoPlistBgTaskIdentifiers(
    cwd: string,
    config: ResolvedConfig,
    identifiers: string[],
): void {
    const plistFile = iosInfoPlistPath(cwd, config);
    if (!existsSync(plistFile)) return;
    const uniqueIdentifiers = Array.from(new Set(identifiers));
    let content = readFileSync(plistFile, 'utf-8');
    const replacement = uniqueIdentifiers.length > 0
        ? `    <!-- Auto-linked BGTaskScheduler permitted identifiers -->\n` +
          `    <key>BGTaskSchedulerPermittedIdentifiers</key>\n    <array>\n` +
          uniqueIdentifiers.map((id) => `        <string>${id}</string>`).join('\n') +
          `\n    </array>`
        : '    <!-- (no auto-linked BGTaskScheduler identifiers) -->';
    content = content.replace('    <!-- {{BG_TASK_IDENTIFIERS}} -->', replacement);
    writeFileIfChanged(plistFile, content);
    if (uniqueIdentifiers.length > 0) {
        log(`iOS: injected ${uniqueIdentifiers.length} BGTaskSchedulerPermittedIdentifiers (${uniqueIdentifiers.join(', ')})`);
    }
}

/**
 * Inject `<service>` declarations into AndroidManifest.xml under `<application>`.
 */
export function injectAndroidServices(
    cwd: string,
    config: ResolvedConfig,
    services: import('./manifest.js').AndroidServiceEntry[],
): void {
    if (services.length === 0) return;
    const manifestFile = androidManifestPath(cwd, config);
    if (!existsSync(manifestFile)) return;
    let content = readFileSync(manifestFile, 'utf-8');
    const blocks = services.map((svc) => {
        const exported = svc.exported ?? false;
        const lines = [
            '        <service',
            `            android:name="${svc.name}"`,
            `            android:exported="${exported}">`,
        ];
        if (svc.actions && svc.actions.length > 0) {
            for (const action of svc.actions) {
                lines.push('            <intent-filter>');
                lines.push(`                <action android:name="${action}" />`);
                lines.push('            </intent-filter>');
            }
        }
        lines.push('        </service>');
        return lines.join('\n');
    }).join('\n');
    content = content.replace(
        '        <!-- {{SERVICES}} -->',
        `        <!-- Auto-linked module services -->\n${blocks}`,
    );
    writeFileIfChanged(manifestFile, content);
    log(`Android: injected ${services.length} service(s)`);
}

/** Escape a string for use inside an XML attribute value. */
function escapeXmlAttr(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Inject `<meta-data>` declarations into AndroidManifest.xml under
 * `<application>`. Values are already resolved by the autolinker (literal /
 * config / placeholder); see `linkAndroid`.
 */
export function injectAndroidMetaData(
    cwd: string,
    config: ResolvedConfig,
    metaData: import('./autolink/android.js').ResolvedAndroidMetaData[],
): void {
    if (metaData.length === 0) return;
    const manifestFile = androidManifestPath(cwd, config);
    if (!existsSync(manifestFile)) return;
    let content = readFileSync(manifestFile, 'utf-8');
    const blocks = metaData
        .map(
            (m) =>
                `        <meta-data android:name="${escapeXmlAttr(m.name)}" android:value="${escapeXmlAttr(m.value)}" />`,
        )
        .join('\n');
    content = content.replace(
        '        <!-- {{META_DATA}} -->',
        `        <!-- Auto-linked module meta-data -->\n${blocks}`,
    );
    writeFileIfChanged(manifestFile, content);
    log(`Android: injected ${metaData.length} meta-data entr${metaData.length === 1 ? 'y' : 'ies'}`);
}

/**
 * Merge attributes onto the `<application>` element in AndroidManifest.xml
 * (app `android.applicationAttributes` + module-contributed attributes, already
 * merged app-wins by the autolinker; values already stringified). For each
 * name: if `android:NAME` already exists on the element its value is replaced
 * (XML forbids duplicate attributes — a second copy is a hard AAPT2 failure),
 * otherwise it's appended before the tag's `>`. No template marker is used
 * because a comment can't live inside an element's open tag; the unique
 * `<application …>` tag is the anchor. Re-applied every prebuild (the manifest
 * is regenerated from the template), so the attributes survive.
 */
export function injectAndroidApplicationAttributes(
    cwd: string,
    config: ResolvedConfig,
    attrs: Record<string, string>,
): void {
    const names = Object.keys(attrs);
    if (names.length === 0) return;
    const manifestFile = androidManifestPath(cwd, config);
    if (!existsSync(manifestFile)) return;
    let content = readFileSync(manifestFile, 'utf-8');

    const openTagRe = /<application\b[^>]*>/;
    const match = content.match(openTagRe);
    if (!match) return;

    let openTag = match[0];
    let appended = '';
    for (const name of names) {
        const value = escapeXmlAttr(attrs[name]);
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const attrRe = new RegExp(`(\\sandroid:${escapedName}=")[^"]*(")`);
        if (attrRe.test(openTag)) {
            // Replace via a function so a `$` in the value isn't treated as a
            // replacement-pattern token.
            openTag = openTag.replace(attrRe, (_full, p1, p2) => `${p1}${value}${p2}`);
        } else {
            appended += `\n        android:${name}="${value}"`;
        }
    }
    if (appended) openTag = openTag.replace(/\s*>$/, `${appended}>`);
    content = content.replace(openTagRe, () => openTag);
    writeFileIfChanged(manifestFile, content);
    log(`Android: applied ${names.length} <application> attribute(s) (${names.join(', ')})`);
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
            keys.map((k) => `    <key>${escapeXmlAttr(k)}</key>\n    <string>${escapeXmlAttr(descriptions[k])}</string>`).join('\n')
          }`
        : '    <!-- (no auto-linked usage descriptions) -->';
    content = content.replace('    <!-- {{USAGE_DESCRIPTIONS}} -->', replacement);
    writeFileIfChanged(plistFile, content);
    if (keys.length > 0) log(`iOS: injected ${keys.length} usage descriptions`);
}

/**
 * Serialize one Info.plist value to its XML node(s), indented under `indent`.
 * The toolchain ships no plist library, so this hand-rolls the plist grammar
 * (matching the rest of the template-based plist generation):
 *   boolean → `<true/>`/`<false/>`, integer → `<integer>`, other finite number
 *   → `<real>`, string → `<string>`, array → `<array>`, object → `<dict>`.
 * Throws on a non-serializable value (null / non-finite / function) so the
 * misconfiguration surfaces at prebuild rather than producing an invalid plist.
 */
export function plistValueToXml(value: PlistValue, indent: string): string {
    if (typeof value === 'boolean') return `${indent}<${value}/>`;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new Error(`Info.plist values must be finite numbers (got ${value}).`);
        }
        return Number.isInteger(value)
            ? `${indent}<integer>${value}</integer>`
            : `${indent}<real>${value}</real>`;
    }
    if (typeof value === 'string') return `${indent}<string>${escapeXmlAttr(value)}</string>`;
    if (Array.isArray(value)) {
        if (value.length === 0) return `${indent}<array/>`;
        const items = value.map((v) => plistValueToXml(v, `${indent}    `)).join('\n');
        return `${indent}<array>\n${items}\n${indent}</array>`;
    }
    if (value !== null && typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) return `${indent}<dict/>`;
        const entries = keys
            .map((k) => `${indent}    <key>${escapeXmlAttr(k)}</key>\n${plistValueToXml(value[k], `${indent}    `)}`)
            .join('\n');
        return `${indent}<dict>\n${entries}\n${indent}</dict>`;
    }
    throw new Error(
        `Unsupported Info.plist value (${value === null ? 'null' : typeof value}); ` +
        `use a boolean, finite number, string, array, or nested object.`,
    );
}

/**
 * Remove a top-level `<key>NAME</key>` + its immediately-following SCALAR value
 * node from a plist's root dict. Anchored to the root dict's 4-space
 * indentation so nested keys (e.g. `UIApplicationSupportsMultipleScenes` inside
 * `UIApplicationSceneManifest`, at 8 spaces) are left untouched. Used to de-dup
 * a generated scalar before `injectInfoPlistExtra` re-emits it — keeping the
 * file clean and free of `plutil` duplicate-key warnings. Array/dict values
 * aren't matched (their nesting can't be removed safely with a regex); a
 * duplicate there falls back to last-write-wins.
 */
function removeTopLevelScalarKey(content: string, key: string): string {
    const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const scalar = '(?:<(?:true|false)/>|<(?:string|integer|real|date|data)>.*?</(?:string|integer|real|date|data)>)';
    const re = new RegExp(`^    <key>${k}</key>\\r?\\n    ${scalar}\\r?\\n`, 'gm');
    return content.replace(re, '');
}

/**
 * Merge arbitrary Info.plist keys (app `ios.infoPlist` + the
 * `usesNonExemptEncryption` convenience + module-contributed keys — already
 * merged app-wins by the autolinker) over the generated plist. Entries are
 * emitted at the `{{INFO_PLIST_EXTRA}}` marker, which sits last in the dict so
 * they win for plist readers (which take the last value on a duplicate key);
 * any prior top-level scalar with the same key is also stripped so the key
 * stays unique. Re-applied every prebuild (the plist is regenerated from the
 * template), so a custom key like `ITSAppUsesNonExemptEncryption` survives
 * without post-prebuild patching.
 */
export function injectInfoPlistExtra(
    cwd: string,
    config: ResolvedConfig,
    extra: Record<string, PlistValue>,
): void {
    const plistFile = iosInfoPlistPath(cwd, config);
    if (!existsSync(plistFile)) return;
    const keys = Object.keys(extra);
    let content = readFileSync(plistFile, 'utf-8');

    // The marker only exists on a freshly-rendered plist (every prebuild
    // regenerates it from the template). If it's already gone the file was
    // processed this run — no-op, so re-invocation stays idempotent and we
    // never strip keys we just injected.
    const marker = '    <!-- {{INFO_PLIST_EXTRA}} -->';
    if (!content.includes(marker)) return;

    for (const key of keys) content = removeTopLevelScalarKey(content, key);

    const replacement = keys.length > 0
        ? `    <!-- App + module Info.plist passthrough (ios.infoPlist) -->\n${
            keys.map((k) => `    <key>${escapeXmlAttr(k)}</key>\n${plistValueToXml(extra[k], '    ')}`).join('\n')
          }`
        : '    <!-- (no extra Info.plist keys) -->';
    content = content.replace(marker, replacement);
    writeFileIfChanged(plistFile, content);
    if (keys.length > 0) log(`iOS: injected ${keys.length} extra Info.plist key(s) (${keys.join(', ')})`);
}

/**
 * Write `Info.debug.plist` — the Debug configuration's Info.plist.
 *
 * The Debug target config points its `INFOPLIST_FILE` here (the iOS
 * analogue of Android's generated `src/debug/AndroidManifest.xml`): the
 * file is the fully-processed `Info.plist` plus usage descriptions from
 * `debugOnly` modules, so App Store binaries don't declare permission
 * strings (camera for the dev-client QR scanner) that no release code
 * uses (#179).
 *
 * Must run AFTER every other Info.plist injector (`applyIosPlistMeta` is
 * the last) — it snapshots the final release plist. Always written, even
 * with no debug-only entries, so the Debug `INFOPLIST_FILE` reference
 * never dangles.
 */
export function writeIosDebugInfoPlist(
    cwd: string,
    config: ResolvedConfig,
    debugDescriptions: Record<string, string>,
): void {
    const plistFile = iosInfoPlistPath(cwd, config);
    if (!existsSync(plistFile)) return;

    const release = readFileSync(plistFile, 'utf-8');
    const keys = Object.keys(debugDescriptions);
    const extra = keys.length > 0
        ? `    <!-- Debug-only usage descriptions (debugOnly modules) — absent from release -->\n${
            keys.map((k) => `    <key>${escapeXmlAttr(k)}</key>\n    <string>${escapeXmlAttr(debugDescriptions[k])}</string>`).join('\n')
          }\n`
        : '';
    // EOL-agnostic anchor — the checkout (and thus the rendered plist) may
    // be CRLF on Windows, and an LF-anchored literal would silently no-op.
    const content = release.replace(/<\/dict>(\r?\n)<\/plist>/, `${extra}</dict>$1</plist>`);
    if (keys.length > 0 && content === release) {
        throw new Error(
            `Could not find the closing </dict></plist> in ${plistFile} — ` +
            `debug-only usage descriptions (${keys.join(', ')}) would be dropped.`,
        );
    }

    const debugPlistFile = join(dirname(plistFile), 'Info.debug.plist');
    writeFileIfChanged(debugPlistFile, content);
    if (keys.length > 0) {
        log(`iOS: wrote Info.debug.plist (${keys.length} debug-only usage description(s))`);
    }
}

/**
 * Ensure the pbxproj carries the dev-client release-exclusion settings on
 * projects scaffolded before they landed in the template (idempotent, runs
 * every prebuild):
 *
 * - Debug `INFOPLIST_FILE` → `Info.debug.plist` (see writeIosDebugInfoPlist)
 * - Release `EXCLUDED_SOURCE_FILE_NAMES = "*\/SigxDevClient\/*"` so the
 *   dev-client Swift never compiles into Release builds. Template code only
 *   references it inside `#if DEBUG`, and the generated registry gates
 *   debugOnly registrations the same way, so Release resolves without it.
 *
 * An existing user-set EXCLUDED_SOURCE_FILE_NAMES is left untouched.
 */
export function applyIosDevClientBuildSettings(cwd: string, config: ResolvedConfig): void {
    const pbxprojPath = join(iosXcodeProjPath(cwd, config), 'project.pbxproj');
    if (!existsSync(pbxprojPath)) return;

    let content = readFileSync(pbxprojPath, 'utf-8');

    // Patch per XCBuildConfiguration block; only target-level blocks carry
    // INFOPLIST_FILE, so project-level configs are untouched by construction.
    content = content.replace(
        /isa = XCBuildConfiguration;[\s\S]*?name = (?:Debug|Release);/g,
        (block) => {
            if (!block.includes('INFOPLIST_FILE')) return block;
            if (block.endsWith('name = Debug;')) {
                return block.replace(
                    /INFOPLIST_FILE = "([^"]*)\/Info\.plist";/,
                    'INFOPLIST_FILE = "$1/Info.debug.plist";',
                );
            }
            if (!block.includes('EXCLUDED_SOURCE_FILE_NAMES')) {
                return block.replace(
                    /(\n(\s*)INFOPLIST_FILE = )/,
                    '\n$2EXCLUDED_SOURCE_FILE_NAMES = "*/SigxDevClient/*";$1',
                );
            }
            return block;
        },
    );

    if (writeFileIfChanged(pbxprojPath, content)) {
        log('iOS: applied dev-client release-exclusion build settings');
    }
}

/** Build an `.entitlements` plist body from an aggregated entitlements map. */
function buildEntitlementsPlist(
    entitlements: Record<string, PlistValue>,
    apsEnvironment: 'development' | 'production',
): string {
    const keys = Object.keys(entitlements);
    const body = keys
        .map((k) => {
            // aps-environment is build-config-dependent by Apple's design:
            // development for Debug, production for Release — regardless of the
            // value a module declared.
            const value = k === 'aps-environment' ? apsEnvironment : entitlements[k];
            return `    <key>${escapeXmlAttr(k)}</key>\n${plistValueToXml(value, '    ')}`;
        })
        .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`;
}

/**
 * Write the app's code-signing entitlements. Mirrors the Info.plist /
 * Info.debug.plist split: `<App>.entitlements` (Release) and
 * `<App>.debug.entitlements` (Debug) are generated from the same aggregated
 * map, differing only in the build-config-dependent `aps-environment` value
 * (production vs development). Returns `true` when entitlements were written
 * (so the caller wires `CODE_SIGN_ENTITLEMENTS`), `false` when none were
 * declared (signing is left untouched).
 */
export function writeIosEntitlements(
    cwd: string,
    config: ResolvedConfig,
    entitlements: Record<string, PlistValue>,
): boolean {
    if (Object.keys(entitlements).length === 0) return false;

    const sourceRoot = iosSourceRoot(cwd, config);
    mkdirSync(sourceRoot, { recursive: true });

    const releaseFile = join(sourceRoot, `${config.name}.entitlements`);
    const debugFile = join(sourceRoot, `${config.name}.debug.entitlements`);
    writeFileIfChanged(releaseFile, buildEntitlementsPlist(entitlements, 'production'));
    writeFileIfChanged(debugFile, buildEntitlementsPlist(entitlements, 'development'));

    log(`iOS: wrote entitlements (${Object.keys(entitlements).join(', ')})`);
    return true;
}

/**
 * Wire `CODE_SIGN_ENTITLEMENTS` per `XCBuildConfiguration` block — Debug points
 * at `<App>.debug.entitlements`, Release at `<App>.entitlements`. The path
 * prefix is taken from the block's existing `INFOPLIST_FILE` so it tracks the
 * app source dir exactly (same per-block approach as
 * `applyIosDevClientBuildSettings`). When `hasEntitlements` is false the
 * setting is left as-is (signing untouched).
 */
export function applyIosEntitlementsBuildSettings(
    cwd: string,
    config: ResolvedConfig,
    hasEntitlements: boolean,
): void {
    if (!hasEntitlements) return;
    const pbxprojPath = join(iosXcodeProjPath(cwd, config), 'project.pbxproj');
    if (!existsSync(pbxprojPath)) return;

    let content = readFileSync(pbxprojPath, 'utf-8');
    content = content.replace(
        /isa = XCBuildConfiguration;[\s\S]*?name = (?:Debug|Release);/g,
        (block) => {
            const infoPlistMatch = block.match(/INFOPLIST_FILE = "([^"]*)\/Info(?:\.debug)?\.plist";/);
            if (!infoPlistMatch) return block;
            const dir = infoPlistMatch[1];
            const isDebug = block.endsWith('name = Debug;');
            const entFile = isDebug ? `${config.name}.debug.entitlements` : `${config.name}.entitlements`;
            const value = `"${dir}/${entFile}"`;
            if (block.includes('CODE_SIGN_ENTITLEMENTS')) {
                return block.replace(/CODE_SIGN_ENTITLEMENTS = [^;]*;/, `CODE_SIGN_ENTITLEMENTS = ${value};`);
            }
            // Insert next to INFOPLIST_FILE, matching its indentation.
            return block.replace(
                /(\n(\s*)INFOPLIST_FILE = )/,
                `\n$2CODE_SIGN_ENTITLEMENTS = ${value};$1`,
            );
        },
    );

    if (writeFileIfChanged(pbxprojPath, content)) {
        log('iOS: wired CODE_SIGN_ENTITLEMENTS per build configuration');
    }
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
 * Clean generated prebuild artifacts. `platforms` scopes the clean so a
 * platform-targeted prebuild (`--android` / `--ios`) never touches the other
 * platform's project; omitted entries default to cleaning that platform.
 */
export function cleanPrebuild(
    cwd: string,
    config: ResolvedConfig,
    full: boolean,
    platforms: { android?: boolean; ios?: boolean } = {},
): void {
    const cleanAndroid = platforms.android !== false;
    const cleanIos = platforms.ios !== false;

    if (full) {
        const androidDir = androidProjectRoot(cwd, config);
        const iosDir = iosProjectRoot(cwd, config);
        if (cleanAndroid && existsSync(androidDir)) {
            rmSync(androidDir, { recursive: true, force: true });
            log(`Cleaned ${androidDirName(config.variant)}/ directory`);
        }
        if (cleanIos && existsSync(iosDir)) {
            rmSync(iosDir, { recursive: true, force: true });
            log(`Cleaned ${iosDirName(config.variant)}/ directory`);
        }
        return;
    }

    // Partial clean — only remove generated registry files
    const applicationId = resolveApplicationId(config);
    const packagePath = packageToPath(applicationId);
    const androidRegistry = join(androidKotlinRoot(cwd, config), packagePath, 'GeneratedModuleRegistry.kt');
    const iosRegistry = join(iosSourceRoot(cwd, config), 'GeneratedModuleRegistry.swift');

    if (cleanAndroid && existsSync(androidRegistry)) {
        unlinkSync(androidRegistry);
        log('Cleaned Android GeneratedModuleRegistry.kt');
    }
    if (cleanIos && existsSync(iosRegistry)) {
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
 * contents of each module's `ios.sourceDir` / `android.sourceDir` (because
 * prebuild copies those files into the consumer's native trees), the CLI
 * version, and which platforms we're building. Used to short-circuit
 * runPrebuild when nothing it cares about has changed since the last run.
 *
 * Notably does NOT hash any files under the consumer's `android/` or `ios/`
 * — those are outputs, not inputs. User edits to native source files are
 * preserved either way (prebuild only touches managed files via
 * writeFileIfChanged).
 *
 * Bug to avoid: a workspace package's `.swift` / `.kt` may change without
 * the manifest changing (e.g. a new prop setter, a new imperative method,
 * a bug-fix in an existing class). If we only hash the manifest, the
 * fast-path skips and the consumer keeps using a stale generated registry
 * + stale copies of the package's native files.
 */
export function fingerprintPrebuildInputs(cwd: string, platforms: { android: boolean; ios: boolean }, variant?: string): string {
    const files: string[] = [];

    for (const name of ['signalx.config.ts', 'signalx.config.js', 'signalx.config.mjs', 'lynx.config.ts', 'lynx.config.js', 'lynx.config.mjs']) {
        const p = join(cwd, name);
        if (existsSync(p)) files.push(p);
    }
    files.push(join(cwd, 'package.json'));

    // The lockfile pins resolved dependency versions. Folding it in means a
    // `@sigx/*` version bump + reinstall invalidates the fast path even when no
    // tracked project source changed — the installed module sources change, and
    // those are what get copied into the native projects (#348).
    const lockfile = findLockfile(cwd);
    if (lockfile) files.push(lockfile);

    // The prebuild.post hook script is an input too — its output lands in
    // the generated native projects. The fast path runs before the config is
    // loaded, so the path comes from the cache sidecar the last successful
    // run wrote. (A newly configured hook is caught via the config file
    // hash; a *moved* one via the sidecar path changing on the next run.)
    const hookPath = readCachedFingerprint(cwd, variant ? `prebuild-post-hook-path-${variant}` : 'prebuild-post-hook-path');
    if (hookPath) files.push(hookPath);

    // The Firebase google-services.json is copied into android/app on every
    // prebuild. Swapping its *contents* (e.g. a different Firebase project)
    // without touching the config path wouldn't otherwise invalidate the fast
    // path. Like the hook, its resolved path comes from a sidecar the last
    // successful run wrote (the fast path runs before config is loaded).
    const googleServicesPath = readCachedFingerprint(cwd, variant ? `prebuild-google-services-path-${variant}` : 'prebuild-google-services-path');
    if (googleServicesPath && existsSync(googleServicesPath)) files.push(googleServicesPath);

    // Index covers transitive module dependencies too (e.g. @sigx/lynx-core
    // pulled in by another module) — their copied sources are prebuild
    // outputs just like direct deps', so they must invalidate the fast path.
    const index = buildManifestIndex(cwd);
    for (const pkg of [...index.keys()].sort()) {
        const manifestPath = index.get(pkg)!;
        files.push(manifestPath);

        // Also fold every file under the package's declared sourceDir into
        // the fingerprint. autolink + copy{Android,Ios}ModuleSources lift
        // those files into the consumer's native tree on every prebuild —
        // when the fast-path skips, the copies don't happen, and a stale
        // `.swift` / `.kt` from a previous run is what lands in the .app.
        // The manifest alone doesn't catch this (it rarely changes when
        // prop setters / UI methods are added or tweaked).
        try {
            const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
                ios?: { sourceDir?: string };
                android?: { sourceDir?: string; releaseStubsDir?: string };
            };
            const pkgDir = dirname(manifestPath);
            for (const sourceDir of [manifest?.ios?.sourceDir, manifest?.android?.sourceDir, manifest?.android?.releaseStubsDir]) {
                if (typeof sourceDir !== 'string' || sourceDir.length === 0) continue;
                for (const f of walkFiles(join(pkgDir, sourceDir))) {
                    files.push(f);
                }
            }
        } catch {
            // Malformed manifest — let validateManifest catch it later in
            // the slow path. Don't taint the fingerprint with a partial
            // failure here.
        }
    }

    return combineHash(files.sort(), {
        // Bump this when the set of *inputs* the fingerprint considers
        // changes (added sourceDir walking, added a new file the prebuild
        // depends on, etc.) — without a bump, users who pulled the fix
        // but kept the old cache file would keep hitting the fast-path
        // until something else happened to invalidate the hash.
        // v2: include each module's ios/android.sourceDir contents.
        // v3: include android.releaseStubsDir contents; dev-client sources
        //     moved to src/debug + release stubs to src/release (#172).
        // v4: include the prebuild.post hook script (via sidecar path, #175).
        // v5: manifests come from buildManifestIndex, so transitively
        //     discovered modules (e.g. @sigx/lynx-core) are fingerprinted too.
        // v6: include the JS lockfile, so a dependency version bump invalidates
        //     the fast path even with no project source change (#348).
        // v7: include the Firebase google-services.json contents (via sidecar
        //     path), so swapping FCM credentials invalidates the fast path (#560).
        fingerprintFormat: 'v7',
        cliVersion: getCliVersion(),
        platforms: `android=${platforms.android};ios=${platforms.ios}`,
        // Variant identity changes the rendered output (suffixed ids, signing,
        // badge) and the output dir, so it must invalidate the fast path.
        variant: variant ?? '',
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
    const variant = opts.variant;
    // Per-variant cache slots + output dirs so a base build and a variant build
    // don't share a fingerprint cache entry (same config inputs → same hash)
    // and so the variant's sentinels point at *its* dir, not the base's. The
    // dir names depend only on the variant string, available before config load.
    const cacheKey = variant ? `prebuild-inputs-${variant}` : 'prebuild-inputs';
    const hookCacheKey = variant ? `prebuild-post-hook-path-${variant}` : 'prebuild-post-hook-path';
    const googleServicesCacheKey = variant ? `prebuild-google-services-path-${variant}` : 'prebuild-google-services-path';
    const androidDirName_ = androidDirName(variant);
    const iosDirName_ = iosDirName(variant);

    // Fast path: skip the whole pipeline (including the esbuild-driven config
    // load) when the inputs haven't changed since the last run AND a small
    // set of "must exist" sentinel outputs are still present on disk. The
    // sentinels catch the cases where a user (or a wayward `rm`) wiped
    // something prebuild was responsible for generating — without those
    // checks, the cached fingerprint would say "all good" and downstream
    // (xcodebuild / gradle / pod install) would fail in a confusing way.
    // `--clean` bypasses both checks.
    if (!opts.clean) {
        const fingerprint = fingerprintPrebuildInputs(cwd, { android: buildAndroid, ios: buildIos }, variant);
        const cached = readCachedFingerprint(cwd, cacheKey);
        // Sentinels are intentionally appName-independent so we can run them
        // *before* the esbuild config load — that's the whole point of the
        // fast path. If we picked appName-scoped sentinels we'd be paying the
        // very cost we're trying to avoid. They ARE variant-scoped (the dir
        // name depends only on the variant string) so a variant's fast path
        // never reads the base build's outputs.
        const iosSentinels = [
            join(cwd, iosDirName_, 'Podfile'),
            // OTA runtime-version sidecar — `sigx updates:publish` needs it.
            runtimeVersionsSidecarPath(cwd),
        ];
        const androidSentinels = [
            join(cwd, androidDirName_, 'app', 'build.gradle.kts'),
            join(cwd, androidDirName_, 'app', 'src', 'main', 'AndroidManifest.xml'),
            runtimeVersionsSidecarPath(cwd),
        ];
        const outputsIntact =
            (!buildIos || iosSentinels.every((p) => existsSync(p))) &&
            (!buildAndroid || androidSentinels.every((p) => existsSync(p)));
        if (cached === fingerprint && outputsIntact) {
            log('Prebuild inputs unchanged — skipping');
            return;
        }
    }

    log(variant ? `Starting prebuild (variant: ${variant})...` : 'Starting prebuild...');

    const rawConfig = await loadConfig(cwd);
    const config = resolveConfig(rawConfig, variant);

    log(`App: ${config.name} v${config.version}`);
    if (variant) {
        log(`Variant: ${variant} → ${config.android.applicationId ?? config.ios.bundleIdentifier} (${androidDirName_}/ ${iosDirName_}/)`);
    }
    log(`Modules: ${config.modules.length}`);

    // Resolve all asset paths and per-platform overrides up front. Falls back
    // to the bundled placeholders in templates/defaults/ when the user hasn't
    // configured icon/splash/adaptiveIcon — guarantees first prebuild produces
    // a working install.
    const assets = resolveAssets(rawConfig, cwd, variant);

    // Clean if requested — full re-scaffold (delete android/ + ios/ and
    // regenerate from the template), matching the Expo-prebuild `--clean`
    // mental model. This is the escape hatch when generated native state drifts
    // from the template; the partial clean (registry files only) is rewritten
    // every prebuild anyway, so it was effectively a no-op here.
    if (opts.clean) {
        cleanPrebuild(cwd, config, true, { android: buildAndroid, ios: buildIos });
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
        // gradlew is scaffold-once; heal its line endings every prebuild so
        // projects generated by older CLIs get a POSIX-executable wrapper (#594).
        ensureGradlewLf(cwd, config);

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
        writeAndroidBehaviors(cwd, config, result.behaviorsCode);
        writeAndroidBundleResolver(cwd, config, result.bundleResolverCode);
        if (result.bundleResolverClass) {
            log(`Android: linked startup bundle resolver (${result.bundleResolverClass})`);
        }
        injectGradleDependencies(cwd, config, result.gradleDependencies, result.debugGradleDependencies);
        injectGradlePlugins(cwd, config, result.gradlePlugins);
        copyGoogleServicesFile(cwd, config, result.services);

        // OTA runtime-version fingerprint — injected as manifest <meta-data>
        // (readable by the copied @sigx/lynx-updates sources) and written to
        // the sidecar `sigx updates:publish` stamps into update manifests.
        const androidRuntimeVersion = computeRuntimeVersion(
            'android', manifests, buildManifestIndex(cwd), config.updates?.runtimeVersion);
        if (!result.metaData.some((m) => m.name === ANDROID_RUNTIME_VERSION_META_KEY)) {
            result.metaData.push({ name: ANDROID_RUNTIME_VERSION_META_KEY, value: androidRuntimeVersion });
        }
        // Active build variant (#530) — travels as <meta-data> so native code
        // (splash, crash reporter) can read it via PackageManager. The JS side
        // gets it from the __SIGX_VARIANT__ define instead.
        if (config.variant && !result.metaData.some((m) => m.name === ANDROID_VARIANT_META_KEY)) {
            result.metaData.push({ name: ANDROID_VARIANT_META_KEY, value: config.variant });
        }
        writeRuntimeVersionsSidecar(cwd, 'android', androidRuntimeVersion);
        log(`Android: runtime version ${androidRuntimeVersion}`);

        injectAndroidPermissions(cwd, config, result.permissions);
        injectAndroidFeatures(cwd, config, result.features);
        writeAndroidDebugManifest(cwd, config, result.debugPermissions);
        injectAndroidServices(cwd, config, result.services);
        injectAndroidMetaData(cwd, config, result.metaData);
        injectAndroidApplicationAttributes(cwd, config, result.applicationAttributes);
        for (const warning of result.metaDataWarnings) {
            log(`\x1b[33m!\x1b[0m ${warning}`);
        }

        // App-shell assets (icons, splash, manifest meta).
        await generateAndroidIcons(cwd, config, assets.android);
        await generateAndroidAdaptiveIcon(cwd, config, assets.android);
        await generateAndroidNotificationIcon(cwd, config, assets.android);
        await generateAndroidSplash(cwd, config, assets.android);
        applyAndroidManifestMeta(cwd, config, assets.android);
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
        if (result.linkedBehaviors.length > 0) {
            log(`Android: linked ${result.linkedBehaviors.length} UI component(s)`);
            log(`  Components: ${result.linkedBehaviors.join(', ')}`);
        }
        warnUnlinkedModules(configModulePackages, manifests, 'Android');

        // Explicit release intent (external archive pipeline) — bake the real
        // built bundle into assets/. Android seeds no placeholder, so without
        // this the APK/AAB has no bundle to load. Throws if unbuilt.
        if (opts.embedBundle) {
            embedBundle({ cwd, config, platform: 'android', log });
        }
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
        writeIosComponentRegistry(cwd, config, result.componentRegistryCode);
        writeIosBundleResolver(cwd, config, result.bundleResolverCode);
        if (result.bundleResolverClass) {
            log(`iOS: linked startup bundle resolver (${result.bundleResolverClass})`);
        }
        injectPodfileEntries(cwd, config, result.podfileEntries);
        injectDebugPodfileEntries(cwd, config, result.debugPodfileEntries);
        injectInfoPlistDescriptions(cwd, config, result.usageDescriptions);

        // OTA runtime-version fingerprint — must precede writeIosDebugInfoPlist
        // (which snapshots the release plist).
        const iosRuntimeVersion = computeRuntimeVersion(
            'ios', manifests, buildManifestIndex(cwd), config.updates?.runtimeVersion);
        injectIosRuntimeVersion(cwd, config, iosRuntimeVersion);
        writeRuntimeVersionsSidecar(cwd, 'ios', iosRuntimeVersion);

        injectInfoPlistBackgroundModes(cwd, config, result.backgroundModes);
        injectInfoPlistBgTaskIdentifiers(cwd, config, result.bgTaskIdentifiers);
        // Active build variant (#530) — surfaced as a plain Info.plist key so
        // native code can read it; the JS side uses the __SIGX_VARIANT__ define.
        // An explicit infoPlist.SigxVariant (unlikely) still wins.
        if (config.variant && !('SigxVariant' in result.infoPlist)) {
            result.infoPlist['SigxVariant'] = config.variant;
        }

        // Arbitrary Info.plist passthrough (app ios.infoPlist /
        // usesNonExemptEncryption + module-contributed keys). Before
        // writeIosDebugInfoPlist, which snapshots the final release plist.
        injectInfoPlistExtra(cwd, config, result.infoPlist);

        // App-shell assets (icons, splash, plist meta).
        await generateIosIcon(cwd, config, assets.ios);
        await generateIosSplash(cwd, config, assets.ios);
        applyIosPlistMeta(cwd, config, assets.ios);

        // Debug-variant Info.plist — MUST come after applyIosPlistMeta (the
        // last release-plist mutation) since it snapshots the final plist.
        writeIosDebugInfoPlist(cwd, config, result.debugUsageDescriptions);

        // CI archivability: shared scheme + config-pinned signing settings.
        writeIosSharedScheme(cwd, config);
        applyIosSigningSettings(cwd, config);
        applyIosDeviceFamily(cwd, config);

        // Dev-client release exclusion + Debug Info.plist wiring for projects
        // scaffolded before these settings landed in the pbxproj template.
        applyIosDevClientBuildSettings(cwd, config);

        // Code-signing entitlements (Push, keychain groups, associated
        // domains, …). Writes the .entitlements files then wires
        // CODE_SIGN_ENTITLEMENTS per build config — no-op when none declared.
        const hasEntitlements = writeIosEntitlements(cwd, config, result.entitlements);
        applyIosEntitlementsBuildSettings(cwd, config, hasEntitlements);

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
        if (opts.embedBundle) {
            // Explicit release intent (external archive pipeline) — bake the
            // real built bundle over any placeholder. Throws if unbuilt.
            embedBundle({ cwd, config, platform: 'ios', log });
        } else if (!existsSync(bundlePath)) {
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
        if (result.linkedComponents.length > 0) {
            log(`iOS: linked ${result.linkedComponents.length} UI component(s)`);
            log(`  Components: ${result.linkedComponents.join(', ')}`);
        }
        warnUnlinkedModules(configModulePackagesIos, manifests, 'iOS');
    }

    // Post-prebuild hook — runs after every managed file has been rendered
    // and every injector has finished, so project patches can never be wiped
    // by a later step (#175). Runs BEFORE the fingerprint is cached: a hook
    // failure leaves no "successful run" marker, so the next prebuild
    // re-runs everything instead of fast-pathing past the broken state.
    await runPostPrebuildHook(cwd, config, {
        android: buildAndroid && config.platforms.includes('android'),
        ios: buildIos && config.platforms.includes('ios'),
    });

    // Remember where the hook script lives so fingerprintPrebuildInputs —
    // which runs before the config is loaded — can hash it on the next run.
    writeCachedFingerprint(
        cwd, hookCacheKey,
        config.prebuild?.post ? resolveHookPath(cwd, config.prebuild.post) : '',
    );

    // Same for the google-services.json: record its resolved path so the next
    // fast-path run folds its contents into the fingerprint (see above).
    const gsFile = config.android.googleServicesFile?.trim();
    writeCachedFingerprint(
        cwd, googleServicesCacheKey,
        gsFile ? (isAbsolute(gsFile) ? gsFile : join(cwd, gsFile)) : '',
    );

    // Record what we just successfully built from so the next runPrebuild
    // can short-circuit when inputs haven't changed.
    const fingerprint = fingerprintPrebuildInputs(cwd, { android: buildAndroid, ios: buildIos }, variant);
    writeCachedFingerprint(cwd, cacheKey, fingerprint);

    log('Prebuild complete!');
}

/** Resolve a `prebuild.post` path against the project root. */
function resolveHookPath(cwd: string, rel: string): string {
    return isAbsolute(rel) ? rel : join(cwd, rel);
}

/**
 * Run the config's `prebuild.post` hook, if any.
 *
 * The module is imported fresh on every call (cache-busting query param) so
 * long-lived processes — the dev server re-runs prebuild without restarting
 * Node — pick up edits to the hook script. A default-export function is
 * awaited with `{ cwd, config, platforms }`; a module without one runs for
 * its side effects on import. Errors propagate and fail the prebuild: a
 * patch that no longer finds its anchor after a template change should stop
 * the build, not ship an unpatched binary.
 */
export async function runPostPrebuildHook(
    cwd: string,
    config: ResolvedConfig,
    platforms: { android: boolean; ios: boolean },
): Promise<void> {
    const rel = config.prebuild?.post;
    if (!rel) return;

    const hookPath = resolveHookPath(cwd, rel);
    if (!existsSync(hookPath)) {
        throw new Error(
            `prebuild.post hook not found: ${hookPath}\n` +
            `(configured as "${rel}" in your project config — the path is resolved from the project root)`,
        );
    }

    log(`Running post-prebuild hook: ${rel}`);
    // Bust Node's ESM cache on the script's CONTENT hash: an edited hook
    // reloads (even within the same millisecond), while repeated prebuilds
    // in a long-lived process (`sigx dev`) reuse the cached module instead
    // of growing the module cache unboundedly.
    const contentHash = createHash('sha256').update(readFileSync(hookPath)).digest('hex').slice(0, 16);
    const mod = await import(`${pathToFileURL(hookPath).href}?v=${contentHash}`);
    if (typeof mod.default === 'function') {
        await mod.default({ cwd, config, platforms });
    }
    log('Post-prebuild hook complete');
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
