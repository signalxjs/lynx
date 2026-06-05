import type { ResolvedConfig, ResolvedModule } from '../config/parser.js';
import type { AndroidActivityHookMethod, AndroidBehaviorEntry, AndroidFeatureEntry, AndroidServiceEntry, ModuleManifest } from '../manifest.js';

/** A `<meta-data>` entry with its value already resolved against config. */
export interface ResolvedAndroidMetaData {
    name: string;
    value: string;
}

/**
 * Android auto-linker.
 *
 * Given a resolved config and module manifests, generates the native code
 * and build config modifications needed to integrate modules into an
 * Android project.
 */

/** Dev-client module info discovered during linking. */
export interface DevClientInfo {
    /** Fully-qualified init class (e.g. com.sigx.devclient.SigxDevClient). */
    initClass: string;
    /** Relative source directory containing Kotlin files to copy. */
    sourceDir: string;
    /**
     * Relative directory of release-safe no-op stubs, copied into the app's
     * `src/release/kotlin` source set (the real sources go to `src/debug`).
     */
    releaseStubsDir?: string;
    /** npm package name (for resolving absolute path from node_modules). */
    packageName: string;
}

/** Lifecycle publisher info discovered during linking. */
export interface AndroidLifecyclePublisherInfo {
    /** Fully-qualified Kotlin class (must accept (lynxView: LynxView) ctor). */
    publisherClass: string;
    /** Relative source directory containing the publisher's Kotlin files. */
    sourceDir: string;
    /** npm package name. */
    packageName: string;
    /** Manifest module name (used in log messages). */
    moduleName: string;
}

/** Generated output from the Android auto-linker. */
export interface AndroidLinkResult {
    /** Kotlin source for module registration. */
    registryCode: string;
    /** Kotlin source for lifecycle-publisher attachment. */
    lifecycleCode: string;
    /** Kotlin source for the Activity-lifecycle hooks dispatcher. */
    activityHooksCode: string;
    /** Kotlin source for the LynxViewBuilder behavior attacher. */
    behaviorsCode: string;
    /** Tag names of behaviors that were registered. */
    linkedBehaviors: string[];
    /** Additional Gradle dependencies to inject. */
    gradleDependencies: string[];
    /** Debug-only Gradle dependencies. */
    debugGradleDependencies: string[];
    /** AndroidManifest permissions to add (release + debug builds). */
    permissions: string[];
    /**
     * Permissions contributed by `debugOnly` modules — written to
     * `src/debug/AndroidManifest.xml` so release APKs don't declare
     * permissions (e.g. CAMERA for the dev-client QR scanner) that no
     * release code uses.
     */
    debugPermissions: string[];
    /** `<uses-feature>` entries to merge into AndroidManifest (de-duped by name). */
    features: AndroidFeatureEntry[];
    /** `<service>` entries to merge into AndroidManifest under `<application>`. */
    services: AndroidServiceEntry[];
    /** `<meta-data>` entries (values resolved) to merge under `<application>`. */
    metaData: ResolvedAndroidMetaData[];
    /** Human-readable warnings about meta-data that fell back to a placeholder. */
    metaDataWarnings: string[];
    /** Modules that were linked. */
    linkedModules: string[];
    /** Lifecycle publishers that were linked. */
    linkedLifecyclePublishers: string[];
    /** Discovered lifecycle publishers (for source copying). */
    lifecyclePublishers: AndroidLifecyclePublisherInfo[];
    /** Module names that registered an Activity hook (for log messages). */
    linkedActivityHooks: string[];
    /** Dev-client module info, if found. */
    devClient?: DevClientInfo;
}

/** Per-method `(hookClass, manifestName)` pairs collected during linking. */
type ActivityHookInvocation = { hookClass: string; manifestName: string };
type ActivityHookGroups = Record<AndroidActivityHookMethod, ActivityHookInvocation[]>;

/** Trim a value and return `undefined` if it's nullish or empty. */
function nonEmpty(value: string | undefined | null): string | undefined {
    if (value == null) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve a dotted path (e.g. `"android.googleMapsApiKey"`) against an object,
 * returning the value as a string when it's a non-empty primitive, else
 * `undefined`. Used by `<meta-data>` `valueFrom` to pull a value the app
 * author set in `signalx.config.ts`.
 */
function resolveConfigPath(obj: unknown, path: string): string | undefined {
    let cur: unknown = obj;
    for (const key of path.split('.')) {
        if (cur == null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[key];
    }
    if (typeof cur === 'string') return nonEmpty(cur);
    if (typeof cur === 'number' || typeof cur === 'boolean') return String(cur);
    return undefined;
}

/**
 * Generate Android auto-link output for a set of modules.
 */
export function linkAndroid(
    config: ResolvedConfig,
    manifests: ModuleManifest[]
): AndroidLinkResult {
    const androidManifests = manifests.filter(
        (m) => m.platforms.includes('android') && m.android
    );

    const linkedModules: string[] = [];
    const linkedLifecyclePublishers: string[] = [];
    const lifecyclePublishers: AndroidLifecyclePublisherInfo[] = [];
    const linkedActivityHooks: string[] = [];
    const activityHookGroups: ActivityHookGroups = {
        onCreate: [],
        onResume: [],
        onPause: [],
        onNewIntent: [],
        onBackPressed: [],
        onRequestPermissionsResult: [],
    };
    const gradleDependencies: string[] = [...(config.android.dependencies ?? [])];
    const debugGradleDependencies: string[] = [];
    const permissions: string[] = [...(config.android.permissions ?? [])];
    const debugPermissions: string[] = [];
    // App-level features are seeded first so they win the de-dupe over any
    // module-contributed entry of the same name.
    const features: AndroidFeatureEntry[] = [...(config.android.features ?? [])];
    const seenFeatureNames = new Set<string>(features.map((f) => f.name));
    const services: AndroidServiceEntry[] = [];
    const seenServiceNames = new Set<string>();
    const metaData: ResolvedAndroidMetaData[] = [];
    const metaDataWarnings: string[] = [];
    const seenMetaDataNames = new Set<string>();
    const behaviors: AndroidBehaviorEntry[] = [];
    const seenBehaviorNames = new Set<string>();
    const registrations: string[] = [];
    const lifecycleAttachments: string[] = [];
    const lifecycleImports: string[] = [];
    let devClient: DevClientInfo | undefined;

    // App-level `<meta-data>` literals are seeded first so they win the
    // de-dupe over any module-contributed entry of the same name — the app
    // author's explicit config is authoritative.
    for (const [rawName, rawValue] of Object.entries(config.android.manifestMetaData ?? {})) {
        const name = rawName.trim();
        const value = nonEmpty(rawValue);
        // Skip undefined/empty values — a common shape is `process.env.X` that
        // isn't set. Pushing those would (a) crash `escapeXmlAttr` on a
        // non-string in `injectAndroidMetaData`, or (b) inject an empty
        // attribute while blocking a module-provided entry of the same name
        // via the de-dupe below (which, for the Maps key, would re-introduce
        // the crash this whole mechanism exists to prevent).
        if (!name || value === undefined) continue;
        if (seenMetaDataNames.has(name)) continue;
        seenMetaDataNames.add(name);
        metaData.push({ name, value });
    }

    for (const manifest of androidManifests) {
        const android = manifest.android!;

        // Each manifest can contribute up to three things — a registered
        // LynxModule (moduleClass), a per-LynxView lifecycle publisher
        // (publisherClass), and a dev-client init facade (initClass). See the
        // iOS autolinker for the rationale; permissions + deps are emitted
        // once per manifest regardless.

        // Lifecycle publisher — instantiated after each LynxView is built.
        if (android.publisherClass && android.sourceDir) {
            linkedLifecyclePublishers.push(manifest.name);
            lifecyclePublishers.push({
                publisherClass: android.publisherClass,
                sourceDir: android.sourceDir,
                packageName: manifest.package,
                moduleName: manifest.name,
            });
            // Use the simple class name in the attach call; emit an explicit
            // import for the FQN so the generated file stays in our chosen
            // namespace regardless of where the publisher lives.
            const simpleName = android.publisherClass.split('.').pop()!;
            lifecycleImports.push(`import ${android.publisherClass}`);
            lifecycleAttachments.push(`        ${simpleName}(lynxView).also { it.attach() }`);
        }

        // Dev-client init facade — debug-only.
        if (manifest.type === 'dev-client' && android.initClass && android.sourceDir) {
            devClient = {
                initClass: android.initClass,
                sourceDir: android.sourceDir,
                releaseStubsDir: android.releaseStubsDir,
                packageName: manifest.package,
            };
            if (!linkedModules.includes(manifest.name)) {
                linkedModules.push(manifest.name);
            }
        }

        // Standard LynxModule.
        if (android.moduleClass) {
            if (!linkedModules.includes(manifest.name)) {
                linkedModules.push(manifest.name);
            }
            registrations.push(
                `        register("${manifest.name}", ${android.moduleClass}::class.java,\n` +
                `            "${manifest.description}",\n` +
                `            emptyList())`
            );
        }

        // Activity-lifecycle hook — register declared methods into the
        // appropriate dispatch list. The hook itself is a Kotlin object
        // (singleton) shipped in the package's `android/` source tree; no
        // import needed because the generated dispatcher uses the FQN.
        if (android.activityHook) {
            const hookClass = android.activityHook.class;
            const methods = android.activityHook.methods ?? [];
            if (methods.length > 0) {
                linkedActivityHooks.push(manifest.name);
                for (const method of methods) {
                    activityHookGroups[method].push({
                        hookClass,
                        manifestName: manifest.name,
                    });
                }
            }
        }

        // Permissions + gradle deps apply to the manifest as a whole.
        if (android.dependencies) {
            if (android.debugOnly) {
                debugGradleDependencies.push(...android.dependencies);
            } else {
                gradleDependencies.push(...android.dependencies);
            }
        }
        if (android.permissions) {
            // debugOnly modules' permissions go to src/debug/AndroidManifest.xml
            // so release APKs don't declare permissions only dev code uses.
            (android.debugOnly ? debugPermissions : permissions).push(...android.permissions);
        }
        if (android.features) {
            for (const feat of android.features) {
                if (seenFeatureNames.has(feat.name)) continue;
                seenFeatureNames.add(feat.name);
                features.push(feat);
            }
        }
        if (android.services) {
            for (const svc of android.services) {
                if (seenServiceNames.has(svc.name)) continue;
                seenServiceNames.add(svc.name);
                services.push(svc);
            }
        }
        if (android.metaData) {
            for (const entry of android.metaData) {
                if (seenMetaDataNames.has(entry.name)) continue;
                // Resolve in order: literal → valueFrom (config path) → default.
                const fromConfig = entry.valueFrom
                    ? resolveConfigPath(config, entry.valueFrom)
                    : undefined;
                const resolved =
                    nonEmpty(entry.value) ?? nonEmpty(fromConfig) ?? nonEmpty(entry.default);
                if (resolved === undefined) continue;
                seenMetaDataNames.add(entry.name);
                metaData.push({ name: entry.name, value: resolved });
                // Warn when a module asked for a config-supplied value, none
                // was set, and we had to fall back to the module's placeholder.
                if (entry.valueFrom && nonEmpty(fromConfig) === undefined && nonEmpty(entry.default) !== undefined) {
                    const help = entry.helpUrl ? ` Get a key: ${entry.helpUrl}` : '';
                    metaDataWarnings.push(
                        `${manifest.package} linked but \`${entry.valueFrom}\` is not set — ` +
                        `using a placeholder for <meta-data ${entry.name}>. ` +
                        `Set it in signalx.config.ts for the feature to work.${help}`,
                    );
                }
            }
        }
        if (android.behaviors) {
            for (const entry of android.behaviors) {
                if (seenBehaviorNames.has(entry.name)) continue;
                seenBehaviorNames.add(entry.name);
                behaviors.push(entry);
            }
        }
    }

    const registryCode = generateRegistryKotlin(registrations, linkedModules);
    const lifecycleCode = generateLifecycleKotlin(lifecycleImports, lifecycleAttachments);
    const activityHooksCode = generateActivityHooksKotlin(activityHookGroups);
    const behaviorsCode = generateBehaviorsKotlin(behaviors);
    const linkedBehaviors = behaviors.map((b) => b.name);

    return {
        registryCode,
        lifecycleCode,
        activityHooksCode,
        behaviorsCode,
        linkedBehaviors,
        gradleDependencies: [...new Set(gradleDependencies)],
        debugGradleDependencies: [...new Set(debugGradleDependencies)],
        permissions: [...new Set(permissions)],
        // A permission already granted to all builds doesn't need a debug copy.
        debugPermissions: [...new Set(debugPermissions)].filter((p) => !permissions.includes(p)),
        features,
        services,
        metaData,
        metaDataWarnings,
        linkedModules,
        linkedLifecyclePublishers,
        lifecyclePublishers,
        linkedActivityHooks,
        devClient,
    };
}

function generateRegistryKotlin(registrations: string[], moduleNames: string[]): string {
    const namesArray = moduleNames.length > 0
        ? moduleNames.map((n) => `"${n}"`).join(', ')
        : '';
    return `package com.sigx.lynxgo.modules

import android.content.Context
import android.util.Log
import com.lynx.tasm.LynxEnv

/**
 * Auto-generated module registry.
 * Generated by \`sigx prebuild\` — do not edit manually.
 */
object GeneratedModuleRegistry {

    private const val TAG = "GeneratedModuleRegistry"
    private val registered = mutableListOf<String>()

    fun registerAll(context: Context) {
        Log.i(TAG, "Registering auto-linked modules...")

${registrations.join('\n\n')}

        Log.i(TAG, "Auto-linked \${registered.size} modules")
    }

    /** List of registered module names (used by dev-menu introspection). */
    fun listModules(): List<String> = listOf(${namesArray})

    private fun register(
        name: String,
        moduleClass: Class<out com.lynx.jsbridge.LynxModule>,
        description: String,
        methods: List<String>
    ) {
        try {
            LynxEnv.inst().registerModule(name, moduleClass)
            registered.add(name)
            Log.d(TAG, "  ✓ \$name")
        } catch (e: Exception) {
            Log.e(TAG, "  ✗ Failed to register \$name: \${e.message}")
        }
    }
}
`;
}

/**
 * Generate the per-LynxView lifecycle-publisher entry point. Hosts call
 * `GeneratedLifecyclePublishers.attachAll(lynxView)` after building each
 * LynxView and retain the returned list so each publisher's observer
 * subscriptions outlive the call. Returning `List<Any>` keeps publisher
 * types opaque so adding a new publisher doesn't churn the host signature.
 */
/**
 * Generate the Activity-lifecycle hook dispatcher.
 *
 * `MainActivity` calls into this object at every lifecycle event (onCreate,
 * onResume, onPause, onNewIntent, onBackPressed, onRequestPermissionsResult).
 * Each method body invokes every registered package's hook in registration
 * order. `onBackPressed` short-circuits on the first hook that returns true.
 *
 * Hook classes are referenced by FQN (no import statements needed). Apps
 * without a given package keep compiling because the dispatcher only
 * references hooks that were actually discovered during linking.
 */
function generateActivityHooksKotlin(groups: ActivityHookGroups): string {
    const renderUnitMethod = (
        name: string,
        signature: string,
        callArgs: string,
        invocations: ActivityHookInvocation[],
    ): string => {
        if (invocations.length === 0) {
            return `    fun ${name}(${signature}) {}`;
        }
        const calls = invocations
            .map((inv) => `        ${inv.hookClass}.${name}(${callArgs})`)
            .join('\n');
        return `    fun ${name}(${signature}) {\n${calls}\n    }`;
    };

    const onBackPressedBody =
        groups.onBackPressed.length === 0
            ? `    fun onBackPressed(activity: Activity): Boolean = false`
            : `    fun onBackPressed(activity: Activity): Boolean {\n` +
              groups.onBackPressed
                  .map(
                      (inv) =>
                          `        if (${inv.hookClass}.onBackPressed(activity)) return true`,
                  )
                  .join('\n') +
              `\n        return false\n    }`;

    const methods = [
        renderUnitMethod(
            'onCreate',
            'activity: Activity, savedInstanceState: Bundle?',
            'activity, savedInstanceState',
            groups.onCreate,
        ),
        renderUnitMethod('onResume', 'activity: Activity', 'activity', groups.onResume),
        renderUnitMethod('onPause', 'activity: Activity', 'activity', groups.onPause),
        renderUnitMethod(
            'onNewIntent',
            'activity: Activity, intent: Intent',
            'activity, intent',
            groups.onNewIntent,
        ),
        onBackPressedBody,
        renderUnitMethod(
            'onRequestPermissionsResult',
            'activity: Activity, requestCode: Int, permissions: Array<String>, grantResults: IntArray',
            'activity, requestCode, permissions, grantResults',
            groups.onRequestPermissionsResult,
        ),
    ].join('\n\n');

    return `package com.sigx.lynxgo.modules

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Auto-generated Activity-lifecycle hook dispatcher.
 * Generated by \`sigx prebuild\` — do not edit manually.
 *
 * Each registered \`@sigx/lynx-*\` package can ship a Kotlin \`object\`
 * implementing some subset of these lifecycle methods. The dispatcher fans
 * the host's lifecycle calls out to every registered hook in the order
 * they were declared. \`onBackPressed\` short-circuits on the first hook
 * that returns true.
 *
 * MainActivity calls every method here at the corresponding lifecycle
 * event. Adding a new package with hooks is a one-package change — no app
 * edit required.
 */
object GeneratedActivityHooks {

${methods}
}
`;
}

/**
 * Generate the behavior attacher. Hosts call
 * `GeneratedBehaviors.attachAll(builder)` alongside the built-in
 * `XElementBehaviors().create()` registration on every
 * `LynxViewBuilder` — production path in `MainActivity`, dev path via the
 * dev-client's `onLynxViewBuilder` callback.
 *
 * Each contributed `Behavior` subclass must expose a no-arg constructor
 * that calls `super("<tag-name>")`; the autolinker only instantiates it.
 * Behavior names are referenced by FQN so the generated file doesn't
 * accumulate per-package imports.
 */
function generateBehaviorsKotlin(behaviors: AndroidBehaviorEntry[]): string {
    const lines = behaviors.map((b) => `        builder.addBehavior(${b.behaviorClass}())`);
    const body = lines.length > 0 ? lines.join('\n') : '        // (no auto-linked behaviors)';
    return `package com.sigx.lynxgo.modules

import com.lynx.tasm.LynxViewBuilder

/**
 * Auto-generated UI behavior attacher.
 * Generated by \`sigx prebuild\` — do not edit manually.
 *
 * Maps JSX tag names to \`Behavior\` subclasses contributed by
 * \`@sigx/lynx-*\` packages declaring \`android.behaviors\` in their
 * \`signalx-module.json\`. Called once per \`LynxViewBuilder\` next to
 * \`XElementBehaviors().create()\`, so every LynxView (production +
 * dev-client) gets the same set of components.
 */
object GeneratedBehaviors {

    val registeredBehaviors: List<String> = listOf(${
        behaviors.length > 0
            ? behaviors.map((b) => `"${b.name}"`).join(', ')
            : ''
    })

    fun attachAll(builder: LynxViewBuilder) {
${body}
    }
}
`;
}

function generateLifecycleKotlin(imports: string[], attachments: string[]): string {
    const importBlock = imports.length > 0 ? '\n' + imports.join('\n') + '\n' : '';
    const body = attachments.length > 0
        ? `        return listOf(\n${attachments.join(',\n')}\n        )`
        : `        return emptyList()`;
    return `package com.sigx.lynxgo.modules

import com.lynx.tasm.LynxView${importBlock}
/**
 * Auto-generated lifecycle-publisher attachment point.
 * Generated by \`sigx prebuild\` — do not edit manually.
 *
 * Hosts call \`attachAll(lynxView)\` after building each LynxView and retain
 * the returned list so each publisher's observer subscriptions outlive the
 * call. Each publisher exposes a single-arg constructor accepting the
 * LynxView plus an \`attach()\` method that wires its observers.
 */
object GeneratedLifecyclePublishers {

    fun attachAll(lynxView: LynxView): List<Any> {
${body}
    }
}
`;
}
