/**
 * Low-level bridge to LynxJS NativeModules.
 *
 * NativeModules is a global object injected by the Lynx runtime.
 * Each registered native module (e.g. Haptics) appears as a property.
 */

declare const NativeModules: Record<string, Record<string, (...args: any[]) => any>>;

/** Known module → package mapping for actionable error messages. */
const MODULE_PACKAGES: Record<string, string> = {
    Haptics: '@sigx/lynx-haptics',
    Clipboard: '@sigx/lynx-clipboard',
    Storage: '@sigx/lynx-storage',
    SecureStorage: '@sigx/lynx-secure-storage',
    Biometric: '@sigx/lynx-biometric',
    DeviceInfo: '@sigx/lynx-device-info',
    Share: '@sigx/lynx-share',
    Audio: '@sigx/lynx-audio',
    Camera: '@sigx/lynx-camera',
    Location: '@sigx/lynx-location',
    ImagePicker: '@sigx/lynx-image-picker',
    FilePicker: '@sigx/lynx-file-picker',
    FileSystem: '@sigx/lynx-file-system',
    Notifications: '@sigx/lynx-notifications',
    Network: '@sigx/lynx-network',
    Linking: '@sigx/lynx-linking',
    WebSocket: '@sigx/lynx-websocket',
};

/**
 * Get a native module by name. Throws with actionable error if unavailable.
 */
export function getModule(name: string): Record<string, (...args: any[]) => any> {
    if (typeof NativeModules === 'undefined' || !NativeModules[name]) {
        const pkg = MODULE_PACKAGES[name] ?? `@sigx/lynx-${name.toLowerCase()}`;
        throw new Error(
            `[@sigx/lynx-core] Module "${name}" is not available.\n` +
            `\n` +
            `This usually means one of:\n` +
            `  1. You're not running in sigx-lynx-go (which has all modules pre-bundled)\n` +
            `  2. For custom builds, install "${pkg}" (\`pnpm add ${pkg}\`) and run\n` +
            `     \`sigx prebuild\` to regenerate the native project.\n` +
            `  3. The native module failed to register — check native logs for errors.`
        );
    }
    return NativeModules[name];
}

/**
 * Call a sync native method. Returns the result directly.
 */
export function callSync<T = void>(module: string, method: string, ...args: any[]): T {
    return getModule(module)[method](...args) as T;
}

/**
 * Call an async native method that uses a callback as its last argument.
 * Wraps the callback in a Promise.
 */
export function callAsync<T = any>(module: string, method: string, ...args: any[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        try {
            getModule(module)[method](...args, (result: T) => resolve(result));
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Check if a native module is registered in the current runtime.
 */
export function isModuleAvailable(name: string): boolean {
    try {
        return typeof NativeModules !== 'undefined' && NativeModules[name] != null;
    } catch {
        return false;
    }
}

/**
 * Guard that throws if a module is not available.
 * Use at the top of module wrapper functions for early, clear errors.
 */
export function guardModule(name: string): void {
    if (!isModuleAvailable(name)) {
        getModule(name); // triggers the descriptive error
    }
}
