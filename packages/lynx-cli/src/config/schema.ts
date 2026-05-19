/**
 * sigx-lynx configuration schema.
 *
 * Used in `signalx.config.ts` at the project root. Declares the app's name,
 * platform settings, and any per-module overrides; installed `@sigx/lynx-*`
 * native modules are auto-discovered and don't need to be declared.
 *
 * In sigx-lynx-go (dev client), ALL modules are pre-bundled so this config
 * is only needed for custom/production builds.
 */

/** Supported platforms for native builds. */
export type Platform = 'android' | 'ios';

/** Activity orientation lock. */
export type Orientation = 'portrait' | 'landscape' | 'default';

/** Icon-set rendering backend. */
export type IconMode = 'svg' | 'font';

/** Font Awesome (and FA-compatible) style variants. */
export type IconStyle = 'solid' | 'regular' | 'brands' | 'light' | 'thin' | 'duotone';

/** A single icon-set declaration. */
export interface IconSetConfig {
    /** Call-site alias: `<Icon set="fa" name="user" />`. Must be unique across sets. */
    id: string;
    /** npm package implementing the set, e.g. '@sigx/lynx-icons-fa-free'. */
    source: string;
    /** Style subset to ship (Font Awesome only). Omit to include every style the adapter exports. */
    styles?: IconStyle[];
    /**
     * Rendering backend for this set.
     * Default: 'font' when the adapter ships a TTF, otherwise 'svg'.
     * Adapters that don't bundle a TTF (e.g. lucide) reject 'font' at validation time.
     */
    mode?: IconMode;
    /**
     * Force-include glyph names that the build-time scanner can't see
     * (e.g. when `name` is a dynamic expression). One entry per glyph name.
     *
     * Pass `['*']` to ship the **full glyph catalog** for the adapter's
     * configured styles — required for JSON-driven UIs / server-driven
     * content where icon names aren't known at build time. Bundle grows
     * to fit the whole set (FA solid ≈ 700 kB, lucide ≈ 300 kB), so use
     * it per-set, only on sets that actually need dynamic names.
     */
    include?: string[];
}

/** A single native module declaration. */
export interface ModuleConfig {
    /** npm package name, e.g. '@sigx/lynx-camera' */
    package: string;
    /**
     * Platforms this module supports. Omit to include on all platforms.
     * Useful when a module is Android-only or iOS-only.
     */
    platforms?: Platform[];
    /**
     * Module-specific native configuration.
     * Passed to the module's native auto-linker (e.g. camera resolution, location accuracy).
     */
    config?: Record<string, unknown>;
    /**
     * Skip linking this module even though it's installed. Useful when an
     * `@sigx/lynx-*` package is pulled in as a transitive dependency you
     * don't want active, or when temporarily disabling a module during
     * debugging without uninstalling it.
     */
    disabled?: boolean;
}

/** Splash / launch screen config. */
export interface SplashConfig {
    /** Path (relative to project root) to splash image PNG. Falls back to bundled default. */
    image?: string;
    /** Background hex color, e.g. '#0D9488'. Default: '#FFFFFF'. */
    backgroundColor?: string;
}

/** Android adaptive icon (Android 8+). */
export interface AdaptiveIconConfig {
    /** Path to foreground PNG. Should be 1024×1024 with logo inside the inner 66% safe zone. */
    foreground: string;
    /** Background hex color. Default: '#FFFFFF'. */
    backgroundColor?: string;
}

/** Android-specific build configuration. */
export interface AndroidConfig {
    /** Application ID (e.g. 'com.mycompany.myapp'). Required for production builds. */
    applicationId?: string;
    /** Minimum SDK version (default: 24). */
    minSdk?: number;
    /** Target SDK version (default: 35). */
    targetSdk?: number;
    /** Compile SDK version (default: 35). */
    compileSdk?: number;
    /** versionCode for Play Store (integer). Default: 1. */
    versionCode?: number;
    /** Additional Gradle dependencies to include. */
    dependencies?: string[];
    /** AndroidManifest.xml permission additions. */
    permissions?: string[];
    /** Override top-level icon for Android only. */
    icon?: string;
    /** Adaptive icon for Android 8+ (foreground + background color). */
    adaptiveIcon?: AdaptiveIconConfig;
    /** Override top-level splash for Android only. */
    splash?: SplashConfig;
    /** Override top-level scheme for Android only. */
    scheme?: string;
    /** Override top-level orientation for Android only. */
    orientation?: Orientation;
}

/** iOS-specific build configuration. */
export interface IosConfig {
    /** Bundle identifier (e.g. 'com.mycompany.myapp'). Required for production builds. */
    bundleIdentifier?: string;
    /** Minimum iOS deployment target (default: '15.0'). */
    deploymentTarget?: string;
    /** CFBundleVersion — store-submission build number, separate from marketing version. Default: '1'. */
    buildNumber?: string;
    /** Additional CocoaPods dependencies. */
    pods?: Record<string, string>;
    /** Info.plist permission usage descriptions. */
    usageDescriptions?: Record<string, string>;
    /** Override top-level icon for iOS only. */
    icon?: string;
    /** Override top-level splash for iOS only. */
    splash?: SplashConfig;
    /** Override top-level scheme for iOS only. */
    scheme?: string;
    /** Override top-level orientation for iOS only. */
    orientation?: Orientation;
}

/** Full sigx-lynx project configuration. */
export interface LynxConfig {
    /** Display name of the app. */
    name: string;
    /** App version string (e.g. '1.0.0'). */
    version?: string;
    /** Build number (iOS CFBundleVersion / Android versionCode origin). Default: '1'. */
    buildNumber?: string;
    /** Path to source app icon (1024×1024 PNG). Falls back to bundled default. */
    icon?: string;
    /** Splash / launch screen. */
    splash?: SplashConfig;
    /** Custom URL scheme for deep linking, e.g. 'myapp' → myapp://. */
    scheme?: string;
    /** Activity orientation. Default: 'portrait'. */
    orientation?: Orientation;
    /**
     * Per-module overrides. Installed `@sigx/lynx-*` packages auto-link via
     * their `signalx-module.json` manifest, so this array is usually unnecessary;
     * declare entries only when you need to:
     * - pass module-specific `config: {…}` to the native auto-linker
     * - restrict a module to certain `platforms: ['ios']`
     * - `disabled: true` an installed module
     *
     * Each entry is either:
     * - A package name string (e.g. '@sigx/lynx-camera')
     * - A ModuleConfig object for advanced configuration
     */
    modules?: (string | ModuleConfig)[];
    /**
     * Package names to skip during auto-discovery. Useful when an
     * `@sigx/lynx-*` module is installed transitively but you don't want
     * it linked into your native build.
     */
    excludeModules?: string[];
    /**
     * Icon sets to enable. Each entry pulls in an adapter package
     * (e.g. `@sigx/lynx-icons-fa-free`) and registers it under `id`.
     * Used icons are auto-detected from JSX at build time and the
     * resulting font (or per-glyph SVG bundle) is tree-shaken/subset
     * to only what your app actually renders.
     */
    iconSets?: IconSetConfig[];
    /** Android-specific configuration. */
    android?: AndroidConfig;
    /** iOS-specific configuration. */
    ios?: IosConfig;
    /**
     * Platforms to build for. Defaults to both.
     * Use to skip a platform entirely.
     */
    platforms?: Platform[];
}

/**
 * Define the sigx-lynx project configuration.
 * Use this in `signalx.config.ts` at the project root.
 *
 * Installed `@sigx/lynx-*` native modules auto-link via their `signalx-module.json`;
 * declare entries under `modules` only to pass per-module `config`, restrict
 * `platforms`, or `disabled: true` an installed module.
 *
 * @example
 * ```ts
 * // signalx.config.ts
 * import { defineLynxConfig } from '@sigx/lynx-cli/config';
 *
 * export default defineLynxConfig({
 *     name: 'My App',
 *     version: '1.0.0',
 *     scheme: 'myapp',
 *     orientation: 'portrait',
 *     icon: 'assets/icon.png',
 *     splash: { image: 'assets/splash.png', backgroundColor: '#0D9488' },
 *     // Native modules auto-discover from installed deps — only list overrides:
 *     modules: [
 *         { package: '@sigx/lynx-location', config: { accuracy: 'high' } },
 *     ],
 *     iconSets: [
 *         { id: 'fa', source: '@sigx/lynx-icons-fa-free', styles: ['solid', 'brands'] },
 *         { id: 'lucide', source: '@sigx/lynx-icons-lucide' },
 *     ],
 *     android: {
 *         applicationId: 'com.mycompany.myapp',
 *         versionCode: 2,
 *         adaptiveIcon: { foreground: 'assets/adaptive-foreground.png', backgroundColor: '#0D9488' },
 *     },
 *     ios: {
 *         bundleIdentifier: 'com.mycompany.myapp',
 *         buildNumber: '2',
 *     },
 * });
 * ```
 */
export function defineLynxConfig(config: LynxConfig): LynxConfig {
    return config;
}
