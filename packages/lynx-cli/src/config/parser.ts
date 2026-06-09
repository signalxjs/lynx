import { join, isAbsolute } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    LynxConfig,
    ModuleConfig,
    Platform,
    Orientation,
    SplashConfig,
    SplashResizeMode,
    AdaptiveIconConfig,
    IconSetConfig,
    IconMode,
    IconStyle,
    IosIconConfig,
} from './schema.js';

const VALID_ICON_MODES: ReadonlySet<IconMode> = new Set(['svg', 'font']);
const VALID_ICON_STYLES: ReadonlySet<IconStyle> = new Set([
    'solid',
    'regular',
    'brands',
    'light',
    'thin',
    'duotone',
]);

/** Default config values applied when not specified by the user. */
const DEFAULTS: Partial<LynxConfig> = {
    version: '1.0.0',
    buildNumber: '1',
    orientation: 'portrait',
    platforms: ['android', 'ios'],
};

const ANDROID_DEFAULTS = {
    minSdk: 24,
    targetSdk: 35,
    compileSdk: 35,
    versionCode: 1,
};

const IOS_DEFAULTS = {
    deploymentTarget: '15.0',
    buildNumber: '1',
};

const SPLASH_BG_DEFAULT = '#FFFFFF';
const ADAPTIVE_BG_DEFAULT = '#FFFFFF';

/** Normalised module entry with all fields resolved. */
export interface ResolvedModule {
    package: string;
    platforms: Platform[];
    config: Record<string, unknown>;
    disabled: boolean;
}

/** Normalised icon-set entry. `mode` is left undefined when the user didn't set it — the build plugin picks per-adapter defaults. */
export interface ResolvedIconSet {
    id: string;
    source: string;
    styles: IconStyle[] | null;
    mode: IconMode | null;
    include: string[];
}

/** Per-platform asset paths, fully resolved (absolute) and ready for sharp. */
export interface ResolvedPlatformAssets {
    iconSource: string;
    splashImage: string;
    splashBackground: string;
    splashResizeMode: SplashResizeMode;
    /** Dark-mode splash; null when not configured (dark devices show the light splash). */
    splashDark: { image: string; backgroundColor: string } | null;
    scheme: string | null;
    orientation: Orientation;
}

export interface ResolvedIosAssets extends ResolvedPlatformAssets {
    /** iOS 18 appearance variants; null entries mean "no variant shipped". */
    iconDark: string | null;
    iconTinted: string | null;
}

export interface ResolvedAndroidAssets extends ResolvedPlatformAssets {
    adaptiveIcon: { foreground: string; backgroundColor: string; monochrome: string | null } | null;
    /** White-on-transparent notification small icon; null = fall back to launcher icon. */
    notificationIcon: string | null;
    notificationColor: string | null;
}

/** Fully resolved configuration with defaults applied. */
export interface ResolvedConfig {
    name: string;
    version: string;
    buildNumber: string;
    modules: ResolvedModule[];
    excludeModules: string[];
    iconSets: ResolvedIconSet[];
    platforms: Platform[];
    android: Required<Pick<NonNullable<LynxConfig['android']>, 'minSdk' | 'targetSdk' | 'compileSdk' | 'versionCode'>> &
        Omit<NonNullable<LynxConfig['android']>, 'minSdk' | 'targetSdk' | 'compileSdk' | 'versionCode'>;
    ios: Required<Pick<NonNullable<LynxConfig['ios']>, 'deploymentTarget' | 'buildNumber'>> &
        Omit<NonNullable<LynxConfig['ios']>, 'deploymentTarget' | 'buildNumber'>;
    prebuild?: LynxConfig['prebuild'];
}

/**
 * Parse and resolve a raw LynxConfig into a fully-resolved config
 * with defaults applied and modules normalised.
 */
export function resolveConfig(raw: LynxConfig): ResolvedConfig {
    const platforms = raw.platforms ?? DEFAULTS.platforms!;
    const buildNumber = raw.buildNumber ?? DEFAULTS.buildNumber!;

    // Make the app's logging config available to the rspeedy child process(es)
    // the build/dev/run commands spawn — they inherit this process's env, and
    // `@sigx/lynx-plugin` reads `SIGX_LYNX_LOGGING` to inject the logger's
    // default level / disabled namespaces and to auto-wire
    // `@sigx/lynx-observability` in release builds. Resolving the config is the
    // one step every command runs before spawning, so this can't miss a site.
    try {
        process.env['SIGX_LYNX_LOGGING'] = JSON.stringify(raw.logging ?? {});
    } catch { /* non-serializable config — skip, plugin falls back to defaults */ }

    return {
        name: raw.name,
        version: raw.version ?? DEFAULTS.version!,
        buildNumber,
        platforms,
        modules: (raw.modules ?? []).map((m) => resolveModule(m, platforms)),
        excludeModules: raw.excludeModules ?? [],
        iconSets: resolveIconSets(raw.iconSets),
        android: {
            ...ANDROID_DEFAULTS,
            ...raw.android,
            dependencies: raw.android?.dependencies ?? [],
            permissions: raw.android?.permissions ?? [],
        },
        ios: {
            ...IOS_DEFAULTS,
            ...raw.ios,
            buildNumber: raw.ios?.buildNumber ?? buildNumber,
            pods: raw.ios?.pods ?? {},
            usageDescriptions: raw.ios?.usageDescriptions ?? {},
        },
        prebuild: raw.prebuild,
    };
}

function resolveModule(entry: string | ModuleConfig, defaultPlatforms: Platform[]): ResolvedModule {
    if (typeof entry === 'string') {
        return { package: entry, platforms: defaultPlatforms, config: {}, disabled: false };
    }
    return {
        package: entry.package,
        platforms: entry.platforms ?? defaultPlatforms,
        config: entry.config ?? {},
        disabled: entry.disabled ?? false,
    };
}

function resolveIconSets(raw: IconSetConfig[] | undefined): ResolvedIconSet[] {
    if (!raw || raw.length === 0) return [];

    const seen = new Set<string>();
    return raw.map((entry, idx) => {
        if (!entry.id || typeof entry.id !== 'string') {
            throw new Error(`iconSets[${idx}].id must be a non-empty string`);
        }
        if (seen.has(entry.id)) {
            throw new Error(`Duplicate iconSets id "${entry.id}"`);
        }
        seen.add(entry.id);

        if (!entry.source || typeof entry.source !== 'string') {
            throw new Error(`iconSets[${idx}] ("${entry.id}").source must be a non-empty string`);
        }

        if (entry.mode !== undefined && !VALID_ICON_MODES.has(entry.mode)) {
            throw new Error(
                `iconSets[${idx}] ("${entry.id}").mode "${entry.mode}" is invalid — expected 'svg' or 'font'`,
            );
        }

        if (entry.styles) {
            for (const style of entry.styles) {
                if (!VALID_ICON_STYLES.has(style)) {
                    throw new Error(
                        `iconSets[${idx}] ("${entry.id}").styles contains unknown style "${style}"`,
                    );
                }
            }
        }

        return {
            id: entry.id,
            source: entry.source,
            styles: entry.styles ?? null,
            mode: entry.mode ?? null,
            include: entry.include ?? [],
        };
    });
}

/**
 * Filter modules for a specific platform.
 */
export function modulesForPlatform(config: ResolvedConfig, platform: Platform): ResolvedModule[] {
    return config.modules.filter((m) => m.platforms.includes(platform));
}

/**
 * Resolve the bundled defaults directory (templates/defaults).
 * Works in both src/ (during dev) and dist/ (when published).
 */
function getDefaultsDir(): string {
    const thisFile = fileURLToPath(import.meta.url);
    // src: packages/lynx-cli/src/config/parser.ts → up to packages/lynx-cli/
    // dist: packages/lynx-cli/dist/config/parser.js → up to packages/lynx-cli/
    const packageRoot = dirname(dirname(dirname(thisFile)));
    return join(packageRoot, 'templates', 'defaults');
}

function resolveAssetPath(cwd: string, value: string | undefined, fallbackName: string): string {
    if (value) {
        return isAbsolute(value) ? value : join(cwd, value);
    }
    return join(getDefaultsDir(), fallbackName);
}

function pickSplash(
    cwd: string,
    base: SplashConfig | undefined,
    override: SplashConfig | undefined,
): {
    image: string;
    backgroundColor: string;
    resizeMode: SplashResizeMode;
    dark: { image: string; backgroundColor: string } | null;
} {
    const image = override?.image ?? base?.image;
    const backgroundColor = override?.backgroundColor ?? base?.backgroundColor ?? SPLASH_BG_DEFAULT;
    const resizeMode = override?.resizeMode ?? base?.resizeMode ?? 'center';

    // Dark variant is opt-in (null = dark devices show the light splash); its
    // unset fields fall back to the light values so `dark: { backgroundColor }`
    // reuses the light logo on a dark background.
    const darkConfigured = override?.dark !== undefined || base?.dark !== undefined;
    const darkImage = override?.dark?.image ?? base?.dark?.image ?? image;
    const darkBackground = override?.dark?.backgroundColor ?? base?.dark?.backgroundColor ?? backgroundColor;

    return {
        image: resolveAssetPath(cwd, image, 'splash.png'),
        backgroundColor,
        resizeMode,
        dark: darkConfigured
            ? { image: resolveAssetPath(cwd, darkImage, 'splash.png'), backgroundColor: darkBackground }
            : null,
    };
}

function pickAdaptive(
    cwd: string,
    raw: AdaptiveIconConfig | undefined,
    androidIconFallback: string,
): { foreground: string; backgroundColor: string; monochrome: string | null } | null {
    if (!raw) return null;
    return {
        foreground: resolveAssetPath(cwd, raw.foreground, 'adaptive-foreground.png'),
        backgroundColor: raw.backgroundColor ?? ADAPTIVE_BG_DEFAULT,
        // Monochrome is opt-in — no bundled placeholder.
        monochrome: raw.monochrome ? resolveAssetPath(cwd, raw.monochrome, '') : null,
    };
    // androidIconFallback intentionally unused — adaptive opts in explicitly.
}

/** Normalise `ios.icon` (string | IosIconConfig | undefined) into per-appearance sources. */
function pickIosIcon(
    cwd: string,
    raw: string | IosIconConfig | undefined,
    topLevelIcon: string | undefined,
): { light: string; dark: string | null; tinted: string | null } {
    // The config is plain JS at runtime — guard against `ios.icon: null`
    // (typeof null === 'object') so "unset via null" degrades to the
    // string/undefined path instead of throwing.
    if (raw !== null && typeof raw === 'object') {
        return {
            light: resolveAssetPath(cwd, raw.light, 'icon.png'),
            dark: raw.dark ? resolveAssetPath(cwd, raw.dark, '') : null,
            tinted: raw.tinted ? resolveAssetPath(cwd, raw.tinted, '') : null,
        };
    }
    return {
        light: resolveAssetPath(cwd, raw ?? topLevelIcon, 'icon.png'),
        dark: null,
        tinted: null,
    };
}

/**
 * Resolve all asset paths and per-platform overrides into ready-to-use values.
 * Paths are absolute. Falls back to bundled placeholders in templates/defaults/
 * when the user hasn't configured an icon/splash.
 */
export function resolveAssets(raw: LynxConfig, cwd: string): {
    ios: ResolvedIosAssets;
    android: ResolvedAndroidAssets;
} {
    const baseOrientation = raw.orientation ?? DEFAULTS.orientation!;
    const baseScheme = raw.scheme ?? null;
    const iosIcon = pickIosIcon(cwd, raw.ios?.icon, raw.icon);
    const androidIcon = resolveAssetPath(cwd, raw.android?.icon ?? raw.icon, 'icon.png');

    const iosSplash = pickSplash(cwd, raw.splash, raw.ios?.splash);
    const androidSplash = pickSplash(cwd, raw.splash, raw.android?.splash);

    return {
        ios: {
            iconSource: iosIcon.light,
            iconDark: iosIcon.dark,
            iconTinted: iosIcon.tinted,
            splashImage: iosSplash.image,
            splashBackground: iosSplash.backgroundColor,
            splashResizeMode: iosSplash.resizeMode,
            splashDark: iosSplash.dark,
            scheme: raw.ios?.scheme ?? baseScheme,
            orientation: raw.ios?.orientation ?? baseOrientation,
        },
        android: {
            iconSource: androidIcon,
            splashImage: androidSplash.image,
            splashBackground: androidSplash.backgroundColor,
            splashResizeMode: androidSplash.resizeMode,
            splashDark: androidSplash.dark,
            scheme: raw.android?.scheme ?? baseScheme,
            orientation: raw.android?.orientation ?? baseOrientation,
            adaptiveIcon: pickAdaptive(cwd, raw.android?.adaptiveIcon, androidIcon),
            notificationIcon: raw.android?.notificationIcon
                ? resolveAssetPath(cwd, raw.android.notificationIcon, '')
                : null,
            notificationColor: raw.android?.notificationColor ?? null,
        },
    };
}
