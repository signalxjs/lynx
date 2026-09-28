export { defineLynxConfig, readEnv, requireEnv } from './schema.js';
export type {
    LynxConfig,
    VariantConfig,
    AppEnvShape,
    AppEnvValue,
    EnvOf,
    ModuleConfig,
    AndroidConfig,
    AndroidFeatureConfig,
    IosConfig,
    IosIconConfig,
    Platform,
    Orientation,
    SplashConfig,
    SplashDarkConfig,
    SplashResizeMode,
    AdaptiveIconConfig,
    IconSetConfig,
    IconMode,
    IconStyle,
    LoggingConfig,
    LogLevelName,
    PlistValue,
} from './schema.js';

export { resolveConfig, modulesForPlatform, resolveAssets, envHash } from './parser.js';
export type {
    ResolvedConfig,
    ResolvedModule,
    ResolvedIconSet,
    ResolvedPlatformAssets,
    ResolvedIosAssets,
    ResolvedAndroidAssets,
} from './parser.js';
