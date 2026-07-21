/**
 * Module manifest schema — `signalx-module.json`.
 *
 * Every @sigx/lynx-* native module package includes this manifest file
 * that tells the auto-linker how to integrate the module into native projects.
 * Community modules follow the same spec.
 */

import type { PlistValue } from './config/schema.js';

export interface ModuleManifest {
    /** Module bridge name as registered in NativeModules (e.g. 'Camera'). */
    name: string;
    /** npm package name. */
    package: string;
    /** Human-readable description. */
    description: string;
    /** Module type: 'module' for standard LynxModule, 'dev-client' for dev tooling. */
    type?: 'module' | 'dev-client';
    /** Platforms this module supports. */
    platforms: ('android' | 'ios')[];
    /** Android-specific auto-link configuration. */
    android?: AndroidManifest;
    /** iOS-specific auto-link configuration. */
    ios?: IosManifest;
}

export interface AndroidManifest {
    /** Fully-qualified Kotlin/Java class name of the LynxModule implementation. */
    moduleClass?: string;
    /**
     * Fully-qualified class name of a lifecycle publisher (used when
     * `kind === 'lifecycle'`). The class is expected to expose a public
     * single-arg constructor `(lynxView: LynxView)` and an `attach()` method;
     * the generated `GeneratedLifecyclePublishers.attachAll(lynxView)` calls
     * `<class>(lynxView).attach()` for each registered publisher.
     */
    publisherClass?: string;
    /**
     * Activity-lifecycle hook — a Kotlin `object` (singleton) declaring zero
     * or more of the supported lifecycle methods. The autolinker generates
     * `GeneratedActivityHooks.kt` that calls every registered hook's methods
     * from `MainActivity`. This is how packages plug into `onCreate` /
     * `onResume` / `onPause` / `onNewIntent` / `onBackPressed` /
     * `onRequestPermissionsResult` without the app having to edit
     * `MainActivity.kt`.
     */
    activityHook?: ActivityHookManifest;
    /** Fully-qualified class name of the init facade (for dev-client type modules). */
    initClass?: string;
    /**
     * Fully-qualified Kotlin object (singleton) exposing
     * `resolveStartupBundlePath(context: Context): String?`. The generated
     * `GeneratedBundleResolver` delegates to it, and the host consults it
     * before falling back to the baked `main.lynx.bundle` asset — this is how
     * an OTA-updates package redirects startup to a downloaded bundle. At
     * most ONE linked module may declare this per platform; the autolinker
     * fails the prebuild when two do.
     */
    bundleResolverClass?: string;
    /** Relative path to Kotlin/Java source directory (for source-based linking). */
    sourceDir?: string;
    /**
     * Relative path to a directory of release-safe no-op stubs. Only
     * meaningful together with `debugOnly: true`: prebuild copies `sourceDir`
     * into the app's `src/debug/kotlin` source set and `releaseStubsDir` into
     * `src/release/kotlin`, so code that references the module's classes
     * (runtime-gated by `BuildConfig.DEBUG`) still compiles in release
     * without pulling in the module's debug-only dependencies.
     */
    releaseStubsDir?: string;
    /**
     * If true, this module is debug-only: its Gradle dependencies are
     * injected as `debugImplementation`, its permissions land in
     * `src/debug/AndroidManifest.xml` (not the release manifest), and its
     * sources are copied into the `src/debug` source set.
     */
    debugOnly?: boolean;
    /** Gradle dependencies to inject into app/build.gradle.kts. */
    dependencies?: string[];
    /**
     * Gradle plugins this module needs applied to the app module. Each entry
     * is injected into the `plugins {}` block of `app/build.gradle.kts` as
     * `id("<id>") version "<version>"`. The canonical case is
     * `@sigx/lynx-notifications`, which needs
     * `com.google.gms.google-services` so the FCM dependency's
     * `google-services.json` is processed into the `google_app_id` /
     * `gcm_defaultSenderId` string resources `FirebaseInitProvider` reads to
     * auto-initialize the default `FirebaseApp` (without it, FCM token
     * retrieval lands in the module's "Firebase not initialised" branch).
     *
     * De-duped on `id` (first wins), so listing the same plugin in multiple
     * modules is safe. The app is a single Gradle module (`include(":app")`),
     * so an inline `version` in the app block is valid — no root `apply false`
     * or version-catalog entry is required.
     */
    gradlePlugins?: AndroidGradlePluginEntry[];
    /** AndroidManifest.xml permissions required. */
    permissions?: string[];
    /**
     * `<uses-feature>` declarations merged into the app's AndroidManifest.
     * Modules whose permissions imply hardware (e.g. CAMERA implies
     * `android.hardware.camera`) should declare the feature with
     * `required: false` so the Play Store doesn't filter the app off devices
     * lacking it. De-duped on `name` (app-level config entries win).
     */
    features?: AndroidFeatureEntry[];
    /** Min SDK required by this module. */
    minSdk?: number;
    /**
     * `<service>` declarations merged into the app's AndroidManifest under
     * `<application>`. Used by modules that need to register a background
     * service — e.g. `@sigx/lynx-notifications` registers a
     * `FirebaseMessagingService` for incoming pushes. The dispatcher de-dupes
     * on `name` so listing the same service in multiple modules is safe.
     */
    services?: AndroidServiceEntry[];
    /**
     * Native UI components (Lynx Behaviors) the package contributes — each
     * entry maps a JSX tag name to a `Behavior` subclass with the matching
     * `LynxUI<View>`. The autolinker generates `GeneratedBehaviors.kt`
     * exposing `attachAll(builder: LynxViewBuilder)`, which the host calls
     * alongside the built-in `XElementBehaviors().create()`.
     *
     * `name` is the JSX tag (e.g. `"sigx-webview"`). `behaviorClass` is the
     * fully-qualified Kotlin class name and must extend
     * `com.lynx.tasm.behavior.Behavior` with a no-arg constructor that calls
     * `super(name)`.
     */
    behaviors?: AndroidBehaviorEntry[];
    /**
     * `<meta-data>` entries merged into the app's AndroidManifest under
     * `<application>`. The Android equivalent of iOS `usageDescriptions` —
     * used by modules that wrap an SDK requiring a manifest meta-data key.
     * The canonical case is `@sigx/lynx-maps`, where the Google Maps SDK
     * hard-crashes the process at first map render unless
     * `com.google.android.geo.API_KEY` is present.
     *
     * The dispatcher de-dupes on `name` (first wins), so listing the same
     * key in multiple modules is safe.
     */
    metaData?: AndroidMetaDataEntry[];
    /**
     * Arbitrary attributes this module requires on the host's `<application>`
     * element (e.g. `{ usesCleartextTraffic: true }`). The `<application>`-
     * attribute counterpart to `metaData`. The `android:` prefix is added
     * automatically; booleans/numbers are stringified. App-level
     * `android.applicationAttributes` wins on name collision; across modules,
     * the first to declare a name wins.
     */
    applicationAttributes?: Record<string, string | boolean | number>;
}

/**
 * A single `<meta-data>` contribution. Exactly one value source is used,
 * resolved in this order: literal `value` → `valueFrom` (a dotted path into
 * the resolved app config, e.g. `"android.googleMapsApiKey"`) when it
 * resolves to a non-empty string → `default`. If none resolve the entry is
 * skipped. A non-empty `default` therefore guarantees the key is always
 * emitted — which is what keeps the Maps SDK from hard-crashing when the app
 * author hasn't supplied a key yet (the SDK renders a blank map for a
 * present-but-invalid key, but aborts the process when the key is absent).
 */
export interface AndroidMetaDataEntry {
    /** Manifest key, e.g. `"com.google.android.geo.API_KEY"`. */
    name: string;
    /** Literal value. Takes precedence over `valueFrom`/`default`. */
    value?: string;
    /**
     * Dotted path into the resolved config whose value fills this entry,
     * e.g. `"android.googleMapsApiKey"`. Lets a module reference a key the
     * app author sets in `signalx.config.ts` without the module shipping it.
     */
    valueFrom?: string;
    /** Fallback when neither `value` nor `valueFrom` resolves to a non-empty string. */
    default?: string;
    /**
     * Optional URL appended to the prebuild warning shown when `valueFrom`
     * didn't resolve and `default` was used — e.g. where to obtain the SDK
     * key. Purely informational.
     */
    helpUrl?: string;
}

export interface AndroidBehaviorEntry {
    name: string;
    behaviorClass: string;
}

/**
 * App config a Gradle plugin depends on. A plugin declaring one is only
 * applied when that config resolves — otherwise linking the module would
 * hard-fail the Android build for everyone who hasn't configured it (#618).
 *
 * A closed set, not an expression language: each value names one thing
 * prebuild knows how to resolve. Unknown values are rejected at injection
 * time rather than silently dropping the plugin.
 */
export type AndroidGradlePluginRequirement = 'android.googleServicesFile';

/** A single Gradle plugin contribution applied to `app/build.gradle.kts`. */
export interface AndroidGradlePluginEntry {
    /** Plugin id, e.g. `"com.google.gms.google-services"`. */
    id: string;
    /** Plugin version, e.g. `"4.4.2"`. */
    version: string;
    /**
     * Only apply this plugin when the named app config resolves — e.g.
     * `"android.googleServicesFile"` for `com.google.gms.google-services`,
     * which hard-fails the build when `google-services.json` is absent.
     * Omit for plugins that stand on their own.
     */
    requires?: AndroidGradlePluginRequirement;
}

/** A single `<uses-feature>` contribution. */
export interface AndroidFeatureEntry {
    /** Feature name, e.g. `"android.hardware.camera"`. */
    name: string;
    /** android:required attribute. Defaults to false. */
    required?: boolean;
}

export interface AndroidServiceEntry {
    /** Fully-qualified service class name. */
    name: string;
    /** android:exported attribute. Defaults to false. */
    exported?: boolean;
    /**
     * Intent-filter actions. Each entry becomes one `<intent-filter>` with a
     * single `<action android:name="…" />`. Sufficient for FirebaseMessagingService
     * (`com.google.firebase.MESSAGING_EVENT`) and the vast majority of system services.
     */
    actions?: string[];
}

/** Recognised Android Activity lifecycle methods a hook can implement. */
export type AndroidActivityHookMethod =
    | 'onCreate'
    | 'onResume'
    | 'onPause'
    | 'onNewIntent'
    | 'onBackPressed'
    | 'onRequestPermissionsResult';

export interface ActivityHookManifest {
    /** Fully-qualified Kotlin object (singleton) class — e.g. `com.sigx.linking.LinkingActivityHook`. */
    class: string;
    /**
     * The lifecycle methods this hook implements. The generator only emits
     * dispatch lines for declared methods, so adding a new method is
     * non-breaking for hooks that don't declare it. Method signatures are
     * fixed by convention — see `LinkingActivityHook` for examples.
     */
    methods: AndroidActivityHookMethod[];
}

export interface IosManifest {
    /** Swift/ObjC class name of the native module. */
    moduleClass?: string;
    /**
     * Swift/ObjC class name of a lifecycle publisher (used when
     * `kind === 'lifecycle'`). The class is expected to expose an
     * `init(lynxView: LynxView)`. The generated
     * `GeneratedLifecyclePublishers.attachAll(to:)` instantiates one per
     * LynxView; the host retains the returned array on a coordinator so the
     * publishers' observer subscriptions outlive the call.
     */
    publisherClass?: string;
    /**
     * AppDelegate-lifecycle hook — Swift class (or `enum` with static
     * methods) declaring zero or more of the supported AppDelegate methods.
     * The autolinker generates `GeneratedAppDelegateHooks.swift` that calls
     * every registered hook's methods from the app's `AppDelegate`.
     */
    appDelegateHook?: IosAppDelegateHookManifest;
    /** Fully-qualified class name of the init facade (for dev-client type modules). */
    initClass?: string;
    /**
     * Swift class/enum exposing
     * `static func resolveStartupBundlePath() -> String?`. The generated
     * `GeneratedBundleResolver` delegates to it, and the host consults it
     * before falling back to the baked `main.lynx.bundle` resource — this is
     * how an OTA-updates package redirects startup to a downloaded bundle.
     * At most ONE linked module may declare this per platform; the
     * autolinker fails the prebuild when two do.
     */
    bundleResolverClass?: string;
    /** Relative path to Swift source directory (for source-based linking). */
    sourceDir?: string;
    /**
     * If true, this module is debug-only: its pods are scoped to the Debug
     * configuration, its `moduleClass` registration is generated inside
     * `#if DEBUG`, and its `usageDescriptions` land in the generated
     * `Info.debug.plist` (Debug configuration) instead of the release
     * Info.plist.
     */
    debugOnly?: boolean;
    /** Method names exported by this module. */
    methods?: string[];
    /** CocoaPods dependencies (name → version). */
    pods?: Record<string, string>;
    /** Info.plist usage description keys required. */
    usageDescriptions?: Record<string, string>;
    /**
     * `UIBackgroundModes` strings merged into Info.plist. e.g.
     * `["remote-notification"]` for silent pushes, `["audio"]` for background
     * audio. De-duped across modules.
     */
    backgroundModes?: string[];
    /**
     * `BGTaskSchedulerPermittedIdentifiers` strings merged into Info.plist.
     * Required for any task identifier registered with `BGTaskScheduler`
     * (used by `@sigx/lynx-background`). De-duped across modules. Each
     * entry must be a reverse-DNS string that exactly matches the
     * identifier passed to `BGTaskScheduler.shared.register(...)`.
     */
    bgTaskIdentifiers?: string[];
    /**
     * Native UI components the package contributes — each entry maps a JSX
     * tag name to a Swift class extending `LynxUI<UIView>`. The autolinker
     * generates `GeneratedComponentRegistry.swift` exposing
     * `registerAll(on: LynxConfig)`, which the host calls in
     * `LynxSetupService.initialize` BEFORE `LynxEnv.prepareConfig` so the
     * shared config snapshot already carries every component.
     *
     * `name` is the JSX tag (e.g. `"sigx-webview"`). `uiClass` is the Swift
     * class name as visible to the auto-generated registry — it lives in
     * the same module as the rest of the app's Swift sources after the
     * autolinker copies the package's `sourceDir`.
     */
    uiComponents?: IosUiComponentEntry[];
    /**
     * Arbitrary Info.plist keys this module requires, merged into the host's
     * Info.plist. The general escape hatch for keys without a dedicated field
     * (e.g. `NSBonjourServices` for a local-network module). Values may be
     * scalars, arrays, or nested dicts. App-level `ios.infoPlist` wins on key
     * collision; across modules, the first to declare a key wins.
     */
    infoPlist?: Record<string, PlistValue>;
    /**
     * Code-signing entitlements this module requires, aggregated into the
     * app's generated `.entitlements` files. The canonical case is
     * `@sigx/lynx-notifications`, which declares
     * `{ "aps-environment": "development" }` so `registerForRemoteNotifications()`
     * can obtain an APNs token (the Push Notifications capability).
     *
     * `aps-environment` is build-config-dependent by Apple's design: prebuild
     * emits `development` in the Debug entitlements and `production` in the
     * Release entitlements regardless of the declared value. All other keys
     * are written identically to both. App-level `ios.entitlements` wins on
     * key collision; across modules, the first to declare a key wins.
     */
    entitlements?: Record<string, PlistValue>;
    /** Minimum iOS deployment target required. */
    deploymentTarget?: string;
}

export interface IosUiComponentEntry {
    name: string;
    uiClass: string;
}

/** Recognised iOS AppDelegate methods a hook can implement. */
export type IosAppDelegateHookMethod =
    | 'didFinishLaunching'
    | 'openURL'
    | 'continueUserActivity'
    | 'didRegisterForRemoteNotificationsWithDeviceToken'
    | 'didFailToRegisterForRemoteNotificationsWithError';

export interface IosAppDelegateHookManifest {
    /** Swift class/enum name — e.g. `LinkingAppDelegateHook`. */
    class: string;
    /** AppDelegate methods this hook implements. */
    methods: IosAppDelegateHookMethod[];
}

/**
 * Validate a module manifest object. Returns errors if invalid.
 */
export function validateManifest(manifest: unknown): string[] {
    const errors: string[] = [];
    if (!manifest || typeof manifest !== 'object') {
        return ['Manifest must be a non-null object'];
    }

    const m = manifest as Record<string, unknown>;

    if (!m.name || typeof m.name !== 'string') {
        errors.push('Missing or invalid "name" field (string required)');
    }
    if (!m.package || typeof m.package !== 'string') {
        errors.push('Missing or invalid "package" field (string required)');
    }
    if (!Array.isArray(m.platforms) || m.platforms.length === 0) {
        errors.push('Missing or empty "platforms" array');
    }
    if (m.type && m.type !== 'module' && m.type !== 'dev-client') {
        errors.push('"type" must be "module" or "dev-client"');
    }
    if ('kind' in m) {
        errors.push('"kind" is no longer supported — set ios.moduleClass and/or ios.publisherClass (and the Android equivalents) directly');
    }

    // Each declared platform must have a config block. Within the block,
    // any of the recognised contributions is fine: a registered class
    // (moduleClass / publisherClass / initClass) OR a sourceDir-only
    // package that just contributes shared native code consumed by other
    // packages (e.g. `@sigx/lynx-permissions`'s PermissionHelper /
    // MediaCapture). Permissions/pods/dependencies on their own are also
    // permitted — that's how pure-config manifests work.
    const platforms = (m.platforms as string[]) ?? [];
    for (const platform of ['ios', 'android'] as const) {
        if (!platforms.includes(platform)) continue;
        const block = m[platform];
        if (!block || typeof block !== 'object') {
            errors.push(`"${platform}" config is required when platforms includes "${platform}"`);
        }
    }

    return errors;
}
