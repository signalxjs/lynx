import { join, isAbsolute } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
    LynxConfig,
    ModuleConfig,
    Platform,
    Orientation,
    SplashConfig,
    AdaptiveIconConfig,
} from './schema.js';

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
}

/** Per-platform asset paths, fully resolved (absolute) and ready for sharp. */
export interface ResolvedPlatformAssets {
    iconSource: string;
    splashImage: string;
    splashBackground: string;
    scheme: string | null;
    orientation: Orientation;
}

export interface ResolvedAndroidAssets extends ResolvedPlatformAssets {
    adaptiveIcon: { foreground: string; backgroundColor: string } | null;
}

/** Fully resolved configuration with defaults applied. */
export interface ResolvedConfig {
    name: string;
    version: string;
    buildNumber: string;
    modules: ResolvedModule[];
    platforms: Platform[];
    android: Required<Pick<NonNullable<LynxConfig['android']>, 'minSdk' | 'targetSdk' | 'compileSdk' | 'versionCode'>> &
        Omit<NonNullable<LynxConfig['android']>, 'minSdk' | 'targetSdk' | 'compileSdk' | 'versionCode'>;
    ios: Required<Pick<NonNullable<LynxConfig['ios']>, 'deploymentTarget' | 'buildNumber'>> &
        Omit<NonNullable<LynxConfig['ios']>, 'deploymentTarget' | 'buildNumber'>;
}

/**
 * Parse and resolve a raw LynxConfig into a fully-resolved config
 * with defaults applied and modules normalised.
 */
export function resolveConfig(raw: LynxConfig): ResolvedConfig {
    const platforms = raw.platforms ?? DEFAULTS.platforms!;
    const buildNumber = raw.buildNumber ?? DEFAULTS.buildNumber!;

    return {
        name: raw.name,
        version: raw.version ?? DEFAULTS.version!,
        buildNumber,
        platforms,
        modules: (raw.modules ?? []).map((m) => resolveModule(m, platforms)),
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
    };
}

function resolveModule(entry: string | ModuleConfig, defaultPlatforms: Platform[]): ResolvedModule {
    if (typeof entry === 'string') {
        return { package: entry, platforms: defaultPlatforms, config: {} };
    }
    return {
        package: entry.package,
        platforms: entry.platforms ?? defaultPlatforms,
        config: entry.config ?? {},
    };
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
): { image: string; backgroundColor: string } {
    const image = override?.image ?? base?.image;
    const backgroundColor = override?.backgroundColor ?? base?.backgroundColor ?? SPLASH_BG_DEFAULT;
    return {
        image: resolveAssetPath(cwd, image, 'splash.png'),
        backgroundColor,
    };
}

function pickAdaptive(
    cwd: string,
    raw: AdaptiveIconConfig | undefined,
    androidIconFallback: string,
): { foreground: string; backgroundColor: string } | null {
    if (!raw) return null;
    return {
        foreground: resolveAssetPath(cwd, raw.foreground, 'adaptive-foreground.png'),
        backgroundColor: raw.backgroundColor ?? ADAPTIVE_BG_DEFAULT,
    };
    // androidIconFallback intentionally unused — adaptive opts in explicitly.
}

/**
 * Resolve all asset paths and per-platform overrides into ready-to-use values.
 * Paths are absolute. Falls back to bundled placeholders in templates/defaults/
 * when the user hasn't configured an icon/splash.
 */
export function resolveAssets(raw: LynxConfig, cwd: string): {
    ios: ResolvedPlatformAssets;
    android: ResolvedAndroidAssets;
} {
    const baseOrientation = raw.orientation ?? DEFAULTS.orientation!;
    const baseScheme = raw.scheme ?? null;
    const iosIcon = resolveAssetPath(cwd, raw.ios?.icon ?? raw.icon, 'icon.png');
    const androidIcon = resolveAssetPath(cwd, raw.android?.icon ?? raw.icon, 'icon.png');

    const iosSplash = pickSplash(cwd, raw.splash, raw.ios?.splash);
    const androidSplash = pickSplash(cwd, raw.splash, raw.android?.splash);

    return {
        ios: {
            iconSource: iosIcon,
            splashImage: iosSplash.image,
            splashBackground: iosSplash.backgroundColor,
            scheme: raw.ios?.scheme ?? baseScheme,
            orientation: raw.ios?.orientation ?? baseOrientation,
        },
        android: {
            iconSource: androidIcon,
            splashImage: androidSplash.image,
            splashBackground: androidSplash.backgroundColor,
            scheme: raw.android?.scheme ?? baseScheme,
            orientation: raw.android?.orientation ?? baseOrientation,
            adaptiveIcon: pickAdaptive(cwd, raw.android?.adaptiveIcon, androidIcon),
        },
    };
}
