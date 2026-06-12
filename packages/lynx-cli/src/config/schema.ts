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

/**
 * Activity orientation lock.
 *
 * - 'portrait' / 'landscape': lock to that orientation.
 * - 'all': explicitly support every orientation, including upside-down
 *   portrait (iOS: all four `UIInterfaceOrientation*`; Android: `fullSensor`).
 * - 'default': platform default (iOS: portrait + both landscapes;
 *   Android: `unspecified`).
 */
export type Orientation = 'portrait' | 'landscape' | 'all' | 'default';

/** Icon-set rendering backend. */
export type IconMode = 'svg' | 'font';

/** Font Awesome (and FA-compatible) style variants. */
export type IconStyle = 'solid' | 'regular' | 'brands' | 'light' | 'thin' | 'duotone';

/**
 * A JSON-serializable Info.plist value: a scalar (`<true/>`/`<false/>`,
 * `<integer>`/`<real>`, `<string>`), an `<array>`, or a nested `<dict>`.
 * Used by the `ios.infoPlist` passthrough (and the module-manifest equivalent).
 */
export type PlistValue =
    | boolean
    | number
    | string
    | PlistValue[]
    | { [key: string]: PlistValue };

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

/** How the splash image is fitted into the screen. */
export type SplashResizeMode = 'contain' | 'cover' | 'center';

/** Dark-mode splash variant. Unset fields fall back to the light splash. */
export interface SplashDarkConfig {
    /** Path to dark-mode splash image PNG. Falls back to the light image. */
    image?: string;
    /** Dark-mode background hex color. Falls back to the light background. */
    backgroundColor?: string;
}

/** Splash / launch screen config. */
export interface SplashConfig {
    /** Path (relative to project root) to splash image PNG. Falls back to bundled default. */
    image?: string;
    /** Background hex color, e.g. '#0D9488'. Default: '#FFFFFF'. */
    backgroundColor?: string;
    /**
     * How the splash image fits the screen. Default: 'center' (logo at its
     * natural size, centered).
     *
     * - 'center': small centered logo over the background color.
     * - 'contain': larger centered logo, never cropped.
     * - 'cover': image fills the screen. Best-effort on both platforms:
     *   Android layer-list bitmaps stretch to fill (use a bleed-safe image),
     *   and iOS `UILaunchScreen` always aspect-fits its image, so 'cover'
     *   renders like 'contain' there (Apple constraint).
     */
    resizeMode?: SplashResizeMode;
    /**
     * Dark-mode splash. When set, Android gets `-night` resources and iOS
     * gets dark-appearance asset variants; when unset, dark-mode devices
     * show the light splash.
     */
    dark?: SplashDarkConfig;
}

/** Android adaptive icon (Android 8+). */
export interface AdaptiveIconConfig {
    /** Path to foreground PNG. Should be 1024×1024 with logo inside the inner 66% safe zone. */
    foreground: string;
    /** Background hex color. Default: '#FFFFFF'. */
    backgroundColor?: string;
    /**
     * Path to monochrome PNG (white-on-transparent silhouette, same 1024×1024
     * safe-zone rules as `foreground`). Emits the `<monochrome>` layer used by
     * Android 13+ themed home-screen icons; without it, themed launchers show
     * a generic fallback shape.
     */
    monochrome?: string;
}

/**
 * iOS app icon with appearance variants (iOS 18+). A plain string `icon`
 * is equivalent to `{ light: <path> }`.
 */
export interface IosIconConfig {
    /** Standard (light) appearance — 1024×1024 PNG. */
    light: string;
    /** Dark appearance. Apple recommends an opaque image (no transparency). */
    dark?: string;
    /** Tinted appearance — grayscale source the system tints. */
    tinted?: string;
    /**
     * Background color used to fill transparency when flattening the standard
     * (light) icon to an opaque PNG. App Store Connect rejects a large app icon
     * that has an alpha channel, so the 1024 marketing icon is always flattened.
     * Hex string, default '#FFFFFF'. iOS masks its own rounded corners at
     * display time, so this only shows if the source art is transparent *within*
     * the square. Does not affect the dark/tinted variants (the system
     * composites those over its own background and they keep their alpha).
     */
    background?: string;
}

/**
 * A `<uses-feature>` declaration for AndroidManifest.xml. Declaring a feature
 * with `required: false` keeps the Play Store from filtering the app off
 * devices that lack the hardware — important because a plain permission
 * declaration (e.g. CAMERA) implicitly marks the matching feature *required*.
 */
export interface AndroidFeatureConfig {
    /** Feature name, e.g. 'android.hardware.camera'. */
    name: string;
    /** Whether the app is unusable without the feature. Default: false. */
    required?: boolean;
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
    /**
     * `<uses-feature>` declarations merged into AndroidManifest.xml, on top
     * of any contributed by linked modules (de-duped by name; the app's
     * entries win).
     */
    features?: AndroidFeatureConfig[];
    /**
     * Google Maps Android SDK API key. Required by `@sigx/lynx-maps` — the
     * SDK aborts the process at first map render if no key is present. The
     * key is injected into AndroidManifest.xml as
     * `<meta-data android:name="com.google.android.geo.API_KEY" />`.
     *
     * Because `signalx.config.ts` is evaluated at prebuild time, you can keep
     * the key out of source control by reading it from the environment:
     * `googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY`. Get a key at
     * https://developers.google.com/maps/documentation/android-sdk/get-api-key
     */
    googleMapsApiKey?: string;
    /**
     * Arbitrary `<meta-data>` entries merged into `<application>` in
     * AndroidManifest.xml (name → value). Escape hatch for SDKs that need a
     * manifest key not covered by a dedicated config field. Merged with any
     * meta-data contributed by linked modules.
     */
    manifestMetaData?: Record<string, string>;
    /**
     * Arbitrary attributes merged onto the `<application>` element in
     * AndroidManifest.xml on every prebuild — the `<application>`-attribute
     * counterpart to `manifestMetaData` (which only adds `<meta-data>`
     * children). Use it for attributes without a dedicated config field, e.g.
     * `{ usesCleartextTraffic: false, largeHeap: true }`. The `android:`
     * namespace prefix is added automatically; booleans and numbers are
     * stringified. Overrides the generated attribute when the name collides
     * (last-write-wins) — XML forbids duplicate attributes. Merged with any
     * attributes contributed by linked modules; these app-level entries win.
     */
    applicationAttributes?: Record<string, string | boolean | number>;
    /** Override top-level icon for Android only. */
    icon?: string;
    /** Adaptive icon for Android 8+ (foreground + background color). */
    adaptiveIcon?: AdaptiveIconConfig;
    /**
     * White-on-transparent PNG used as the status-bar small icon for
     * notifications (Android renders small icons as monochrome silhouettes,
     * so a full-color launcher icon shows up as a blob). Generated into
     * `res/drawable-<density>/ic_notification.png`; `@sigx/lynx-notifications`
     * resolves it by name and falls back to the launcher icon when unset.
     */
    notificationIcon?: string;
    /**
     * Accent hex color applied to notifications (icon tint / accents).
     * Generated as `@color/notification_color` and wired up via the standard
     * default-notification-color manifest meta-data.
     */
    notificationColor?: string;
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
    /**
     * Apple Developer Team ID (e.g. 'AB12CD34EF') rendered into the Xcode
     * project's `DEVELOPMENT_TEAM`. Required for signed device builds and
     * CI archiving (TestFlight / App Store). When unset, prebuild leaves the
     * project's existing value untouched so tooling like fastlane's
     * `update_code_signing_settings` keeps working.
     */
    developmentTeam?: string;
    /**
     * Xcode `CODE_SIGN_STYLE`. 'Automatic' (the scaffold default) lets Xcode
     * manage profiles; store distribution from CI generally needs 'Manual'
     * plus a provisioning profile (e.g. via fastlane match). When unset,
     * prebuild leaves the project's existing value untouched.
     */
    codeSignStyle?: 'Automatic' | 'Manual';
    /**
     * Whether the app runs on iPad as well as iPhone. Default: true
     * (`TARGETED_DEVICE_FAMILY = "1,2"`); set false for an iPhone-only app
     * (`"1"` — iPads run it in compatibility mode).
     */
    supportsTablet?: boolean;
    /**
     * Emit `UIRequiresFullScreen` and opt out of iPad multitasking
     * (Split View / Slide Over). Default: false.
     *
     * This is also the iPad orientation lever: multitasking-capable apps
     * MUST support all four orientations on iPad (App Store validation), so
     * by default `UISupportedInterfaceOrientations~ipad` lists all four
     * regardless of the configured `orientation` lock. With
     * `requiresFullScreen: true`, the iPad follows the same lock as the
     * iPhone.
     */
    requiresFullScreen?: boolean;
    /** Additional CocoaPods dependencies. */
    pods?: Record<string, string>;
    /** Info.plist permission usage descriptions. */
    usageDescriptions?: Record<string, string>;
    /**
     * `BGTaskSchedulerPermittedIdentifiers` to inject into Info.plist. Apps
     * using `@sigx/lynx-background` must list every reverse-DNS task
     * identifier they register here (typically `${bundleIdentifier}.bg.${taskName}`).
     * Merged with any identifiers contributed by linked modules.
     */
    bgTaskIdentifiers?: string[];
    /**
     * Arbitrary Info.plist keys merged over the generated plist on every
     * prebuild (last-write-wins), so a custom key survives without
     * post-prebuild patching. The general escape hatch for keys without a
     * dedicated config field; values may be scalars, arrays, or nested dicts.
     * Merged with any keys contributed by linked modules — these app-level
     * entries win on collision. Example:
     *
     *     infoPlist: { ITSAppUsesNonExemptEncryption: false }
     */
    infoPlist?: Record<string, PlistValue>;
    /**
     * Convenience for the near-universal `ITSAppUsesNonExemptEncryption`
     * Info.plist key. Set `false` if the app uses only standard, exempt
     * encryption (e.g. HTTPS) to auto-clear App Store Connect's "Missing
     * Compliance" prompt on every TestFlight / App Store build. Maps straight
     * to the key; an explicit `infoPlist.ITSAppUsesNonExemptEncryption` wins
     * if both are set.
     */
    usesNonExemptEncryption?: boolean;
    /**
     * Override top-level icon for iOS only. A string is the light icon; an
     * `IosIconConfig` object adds iOS 18 dark/tinted appearance variants.
     */
    icon?: string | IosIconConfig;
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
    /** Prebuild lifecycle hooks. */
    prebuild?: PrebuildHooksConfig;
    /** Logging & observability. See {@link LoggingConfig}. */
    logging?: LoggingConfig;
    /** OTA updates (`@sigx/lynx-updates`). See {@link UpdatesConfig}. */
    updates?: UpdatesConfig;
}

/**
 * OTA updates configuration (`updates: { … }` in `defineLynxConfig`).
 * Build-time settings only — runtime behavior (provider URL, update mode)
 * is configured in JS via `Updates.configure()` from `@sigx/lynx-updates`.
 */
export interface UpdatesConfig {
    /**
     * Pin the runtime version instead of using the computed fingerprint.
     * By default prebuild fingerprints the native runtime (linked native
     * modules' source content + Lynx SDK version + scaffold revision) and
     * updates only apply on binaries with a matching fingerprint. Set an
     * explicit string (e.g. `'1.0.0'`) to manage compatibility manually,
     * Expo-style — you then own the guarantee that every binary sharing the
     * pin can run every update published for it.
     */
    runtimeVersion?: string;
    /**
     * Release channel baked into the JS bundle as the default for
     * `Updates.configure()` (overridable there). Default: `'production'`.
     */
    defaultChannel?: string;
}

/** Log level for `@sigx/lynx-core`'s logger (ascending severity; `silent` mutes all). */
export type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Logging & observability (`logging: { … }` in `defineLynxConfig`). Honored by
 * the build: the level/disabled namespaces are baked into the bundle, and in
 * **release** builds `production` auto-wires `@sigx/lynx-observability` (install
 * it as a dependency) — no manual `initObservability()` call needed.
 */
export interface LoggingConfig {
    /**
     * Minimum level emitted at runtime. Overridable at runtime via `setLogLevel()`.
     * Defaults to `'debug'` under `sigx dev` and `'warn'` for release builds.
     */
    level?: LogLevelName;
    /** Namespace controls. */
    namespaces?: {
        /** Namespaces silenced at startup (e.g. `['http']` to mute request logs). */
        disabled?: string[];
    };
    /**
     * Production observability — auto-wired in release builds when set (requires
     * `@sigx/lynx-observability` installed). Captures uncaught errors and ships
     * records to a remote sink.
     */
    production?: {
        /** Remote sink to POST batched records to. Omit to only capture errors. */
        sink?: {
            url: string;
            headers?: Record<string, string>;
            /** Only send records at or above this level. */
            minLevel?: LogLevelName;
            /** Keep this fraction (0–1) of non-error records; errors always kept. */
            sampleRate?: number;
        };
        /** Capture uncaught errors / unhandled rejections. Default `true`. */
        captureErrors?: boolean;
    };
}

/** Prebuild lifecycle hooks (`prebuild: { … }` in `defineLynxConfig`). */
export interface PrebuildHooksConfig {
    /**
     * Path (relative to the project root) to a plain-JS module
     * (`.mjs`/`.js`/`.cjs`) executed after `sigx prebuild` has rendered all
     * managed native files (build.gradle.kts, Info.plist, Podfile, …) and
     * finished auto-linking. Use it for project-specific native patches the
     * config schema can't express — prebuild guarantees the ordering, so a
     * patch can never be wiped by a later template re-render.
     *
     * If the module's default export is a function it is awaited with
     * `{ cwd, config, platforms }` (project root, the resolved config, and
     * which platforms were prebuilt); a module without one runs for its
     * side effects on import.
     *
     * Managed files are re-rendered pristine at the start of every full
     * prebuild before the hook runs, so write patches that anchor on
     * template text and fail loudly when the anchor is missing — silent
     * drift after a lynx-cli upgrade is exactly what this hook exists to
     * prevent. The hook is skipped when prebuild itself is skipped (inputs
     * unchanged — the previous run's patches are still in place); editing
     * the hook script counts as an input change and re-triggers it.
     *
     * @example
     * ```ts
     * prebuild: { post: './scripts/native-patches.mjs' }
     * ```
     */
    post?: string;
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
 *     splash: {
 *         image: 'assets/splash.png',
 *         backgroundColor: '#0D9488',
 *         dark: { backgroundColor: '#134E4A' },
 *     },
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
 *         adaptiveIcon: {
 *             foreground: 'assets/adaptive-foreground.png',
 *             backgroundColor: '#0D9488',
 *             monochrome: 'assets/adaptive-monochrome.png',
 *         },
 *         notificationIcon: 'assets/notification-icon.png',
 *         notificationColor: '#0D9488',
 *     },
 *     ios: {
 *         bundleIdentifier: 'com.mycompany.myapp',
 *         buildNumber: '2',
 *         icon: { light: 'assets/icon.png', dark: 'assets/icon-dark.png' },
 *     },
 * });
 * ```
 */
export function defineLynxConfig(config: LynxConfig): LynxConfig {
    return config;
}
