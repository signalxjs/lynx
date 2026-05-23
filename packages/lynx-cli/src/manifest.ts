/**
 * Module manifest schema — `signalx-module.json`.
 *
 * Every @sigx/lynx-* native module package includes this manifest file
 * that tells the auto-linker how to integrate the module into native projects.
 * Community modules follow the same spec.
 */

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
    /** Relative path to Kotlin/Java source directory (for source-based linking). */
    sourceDir?: string;
    /** If true, this module is only linked in debug builds (debugImplementation). */
    debugOnly?: boolean;
    /** Gradle dependencies to inject into app/build.gradle.kts. */
    dependencies?: string[];
    /** AndroidManifest.xml permissions required. */
    permissions?: string[];
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
}

export interface AndroidBehaviorEntry {
    name: string;
    behaviorClass: string;
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
    /** Relative path to Swift source directory (for source-based linking). */
    sourceDir?: string;
    /** If true, this module is only linked in debug builds. */
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
