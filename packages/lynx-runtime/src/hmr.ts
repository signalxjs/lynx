/**
 * HMR runtime for sigx-lynx (rspack/rsbuild).
 *
 * The `@sigx/lynx` meta package inlines runtime-core into a single bundle,
 * so `@sigx/runtime-core/internals` would resolve to a *different* copy of
 * the plugin registry than the one used by `component()`.  To work around
 * this the HMR loader injects a call to `initHMR(registerComponentPlugin)`
 * where `registerComponentPlugin` is imported from `@sigx/lynx` (the same
 * bundle the app uses), ensuring a single shared plugin array.
 *
 * Flow:
 *   1. Loader prepends:
 *        import { __registerComponentPlugin } from '@sigx/lynx';
 *        import { initHMR, registerHMRModule } from '@sigx/lynx-runtime/hmr';
 *        initHMR(__registerComponentPlugin);
 *        registerHMRModule('<moduleId>');
 *   2. On first call, `initHMR` installs the onDefine plugin.
 *   3. On HMR update the module re-executes, `registerHMRModule` resets
 *      the per-module index, `component()` fires `onDefine`, and existing
 *      instances are patched in-place (property-ops only — no crash).
 */

// Type-only import — NOT a runtime import from runtime-core
import type { ComponentSetupContext } from '@sigx/runtime-core/internals';

type RegisterFn = (plugin: { onDefine?: (name: string | undefined, factory: any, setup: Function) => void }) => void;
type SetCurrentInstanceFn = (ctx: ComponentSetupContext | null) => ComponentSetupContext | null;

interface InstanceEntry {
    ctx: ComponentSetupContext;
}

// Track instances by component ID (moduleId:index)
const instancesByComponentId = new Map<string, Set<InstanceEntry>>();

// Track component definition order within each module
const moduleComponentIndex = new Map<string, number>();

// Current module being registered
let currentModuleId: string | null = null;

// The renderer's currentInstance setter — captured from the app-side bundle
// so push/pop targets the SAME instance stack the renderer reads from. If
// missing (older app version that doesn't inject it), HMR patches skip the
// push/pop and rely on the caller having no context-dependent hooks.
let setCurrentInstance: SetCurrentInstanceFn | null = null;

let installed = false;

/**
 * Initialise the HMR plugin using the *app-side* registerComponentPlugin.
 * Called once by the loader-injected preamble.  Idempotent.
 *
 * `setCurrentInstanceFn` is the renderer's instance-stack push/pop helper
 * (re-exported from `@sigx/lynx` as `__setCurrentInstanceForHMR`). Without
 * it, re-running a screen's setup during HMR throws on hooks that depend on
 * provide/inject (`useNav`, etc.) because the renderer's currentInstance is
 * `null` when called outside the normal mount path.
 */
export function initHMR(
    registerComponentPlugin: RegisterFn,
    setCurrentInstanceFn?: SetCurrentInstanceFn,
): void {
    if (installed) return;
    installed = true;

    if (setCurrentInstanceFn) {
        setCurrentInstance = setCurrentInstanceFn;
    }

    registerComponentPlugin({
        onDefine(name: string | undefined, factory: any, setup: Function) {
            const componentId = getNextComponentId();
            if (!componentId) return;

            factory.__hmrId = componentId;

            const existingInstances = instancesByComponentId.get(componentId);

            if (existingInstances && existingInstances.size > 0) {
                // HMR update: patch all existing instances with the new setup.
                // The renderer pushes the active instance onto a stack before
                // calling setup so that hooks like `useNav()` can resolve
                // provide/inject up the parent chain. We're calling setup
                // *outside* the renderer's mount path here, so we mirror the
                // push/pop ourselves — otherwise context-dependent hooks
                // throw with messages like "no <NavigationRoot> is mounted".
                existingInstances.forEach(instance => {
                    const prev = setCurrentInstance ? setCurrentInstance(instance.ctx) : null;
                    try {
                        const newRenderFn = setup(instance.ctx);
                        instance.ctx.renderFn = newRenderFn;
                        instance.ctx.update();
                    } catch (e: any) {
                        const msg = e?.message ?? String(e);
                        const stack = e?.stack ?? '<no stack>';
                        console.error(
                            `[sigx-hmr] Failed to update ${name || 'component'}: ${msg}\n${stack}`,
                        );
                    } finally {
                        if (setCurrentInstance) setCurrentInstance(prev);
                    }
                });
            }

            // Wrap setup to track future instances
            const originalSetup = setup;

            factory.__setup = (ctx: ComponentSetupContext) => {
                const renderFn = originalSetup(ctx);

                const instance: InstanceEntry = { ctx };

                let instances = instancesByComponentId.get(componentId);
                if (!instances) {
                    instances = new Set();
                    instancesByComponentId.set(componentId, instances);
                }
                instances.add(instance);

                ctx.onUnmounted(() => {
                    const instances = instancesByComponentId.get(componentId);
                    if (instances) instances.delete(instance);
                });

                return renderFn;
            };
        }
    });
}

/**
 * Register the current module for HMR tracking.
 * Called at the top of each transformed module by the HMR loader.
 */
export function registerHMRModule(moduleId: string): void {
    currentModuleId = moduleId;
    moduleComponentIndex.set(moduleId, 0);
}

/**
 * Get the next component ID for the current module.
 */
function getNextComponentId(): string | null {
    if (!currentModuleId) return null;

    const index = moduleComponentIndex.get(currentModuleId) || 0;
    moduleComponentIndex.set(currentModuleId, index + 1);

    return `${currentModuleId}:${index}`;
}
