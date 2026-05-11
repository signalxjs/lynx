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

interface InstanceEntry {
    ctx: ComponentSetupContext;
}

// Track instances by component ID (moduleId:index)
const instancesByComponentId = new Map<string, Set<InstanceEntry>>();

// Track component definition order within each module
const moduleComponentIndex = new Map<string, number>();

// Current module being registered
let currentModuleId: string | null = null;

let installed = false;

/**
 * Initialise the HMR plugin using the *app-side* registerComponentPlugin.
 * Called once by the loader-injected preamble.  Idempotent.
 */
export function initHMR(registerComponentPlugin: RegisterFn): void {
    if (installed) return;
    installed = true;

    registerComponentPlugin({
        onDefine(name: string | undefined, factory: any, setup: Function) {
            const componentId = getNextComponentId();
            if (!componentId) return;

            factory.__hmrId = componentId;

            const existingInstances = instancesByComponentId.get(componentId);

            if (existingInstances && existingInstances.size > 0) {
                // HMR update: patch all existing instances with the new setup
                existingInstances.forEach(instance => {
                    try {
                        const newRenderFn = setup(instance.ctx);
                        instance.ctx.renderFn = newRenderFn;
                        instance.ctx.update();
                    } catch (e) {
                        console.error(`[sigx-hmr] Failed to update ${name || 'component'}:`, e);
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
