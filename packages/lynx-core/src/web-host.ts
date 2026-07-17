/**
 * Worker→host-page RPC for web builds (signalxjs/lynx#703).
 *
 * On web (`@lynx-js/web-core`) the app's background code runs in a Web
 * Worker where most browser APIs (`navigator.clipboard`, `window.open`,
 * `<input type=file>`, …) don't exist. Upstream web-core ships a bridge:
 * `NativeModules.bridge.call(name, data, callback)` RPCs to the UI thread,
 * where the `<lynx-view>` element's `onNativeModulesCall(name, data,
 * moduleName)` handler runs and its (possibly async) return value resolves
 * back into `callback`. Calls made before the handler is assigned are cached
 * by web-core, so early calls are safe.
 *
 * `@sigx/lynx-web-host` installs the host-side handler; this module is the
 * worker-side caller that the per-package `.web.ts` shims use.
 *
 * Protocol: `name` = `sigx.<module>.<method>`, `data` JSON-cloneable,
 * responses `{ok: true, value} | {ok: false, error}` so rejections carry
 * messages across the RPC. A host without the sigx handler responds
 * `undefined` → rejected with an actionable message.
 */

interface BridgeModuleLike {
  call?: (name: string, data: unknown, callback: (res: unknown) => void) => void;
}

declare const NativeModules:
  | { bridge?: BridgeModuleLike; [k: string]: unknown }
  | undefined;

/** Whether the web-core worker bridge exists (web builds only). */
export function isWebHostAvailable(): boolean {
  return typeof NativeModules !== 'undefined' && typeof NativeModules?.bridge?.call === 'function';
}

/**
 * Call a `sigx.*` handler on the host page. `name` is the un-prefixed
 * `<module>.<method>` (e.g. `'clipboard.setString'`); the `sigx.` namespace
 * is added here.
 */
export function webHostCall<T = unknown>(name: string, data?: unknown): Promise<T> {
  if (!isWebHostAvailable()) {
    return Promise.reject(
      new Error(
        `[@sigx/lynx-core] webHostCall("${name}") — the web-core bridge is not available ` +
          '(not running in a @lynx-js/web-core worker?).',
      ),
    );
  }
  return new Promise<T>((resolve, reject) => {
    NativeModules!.bridge!.call!(`sigx.${name}`, data, (res: unknown) => {
      if (res && typeof res === 'object' && 'ok' in (res as Record<string, unknown>)) {
        const r = res as { ok: boolean; value?: T; error?: string };
        if (r.ok) resolve(r.value as T);
        else reject(new Error(r.error ?? `[@sigx/lynx-core] web host call "${name}" failed`));
        return;
      }
      reject(
        new Error(
          `[@sigx/lynx-core] no web-host response for "${name}" — is the page's ` +
            '`installSigxWebHost` (from @sigx/lynx-web-host) wired up? `sigx run:web` does this automatically.',
        ),
      );
    });
  });
}
