/**
 * `@sigx/lynx-web-host` — the host-page side of SignalX's web support
 * (signalxjs/lynx#703).
 *
 * A SignalX app on web runs inside upstream `@lynx-js/web-core`: background
 * code in a Web Worker, main-thread code in a hidden iframe. Browser APIs
 * that only exist on the page (`navigator.clipboard`, `window.open`,
 * `matchMedia`, `<input type=file>`, vibration) are reached through
 * web-core's worker→UI RPC: the worker's `NativeModules.bridge.call(name,
 * data, cb)` invokes the `<lynx-view>` element's `onNativeModulesCall`
 * handler here, and the handler's (possibly async) return value resolves back
 * to the worker (`@sigx/lynx-core`'s `webHostCall`).
 *
 * `installSigxWebHost(lynxView)`:
 *  1. assigns `onNativeModulesCall` and dispatches `sigx.<module>.<method>`
 *     calls to the handlers below (responses `{ok, value}|{ok:false,error}`);
 *  2. wires the **appearance publisher** — `globalProps.appearance =
 *     {colorScheme}` from `matchMedia('(prefers-color-scheme: dark)')`, live
 *     updates via `updateGlobalProps` + `sendGlobalEvent('appearanceChanged',
 *     [{colorScheme}])` — exactly what `@sigx/lynx-appearance` reads, so that
 *     package needs no web shim at all;
 *  3. wires the **inbound-linking publisher** — `globalProps.initialURL` +
 *     `sendGlobalEvent('urlReceived', [url])` on popstate/hashchange, which
 *     `@sigx/lynx-linking`'s reader consumes unchanged.
 *
 * This file is deliberately **import-free** so the compiled `dist/host.js` is
 * a self-contained ESM module the host page can load without a bundler
 * (`sigx run:web` serves it as `/host/sigx-host.js`). Coupled to web-core's
 * `bridge` module + `onNativeModulesCall` contract — see the README for the
 * pinned version range.
 */

type HostResponse = { ok: true; value?: unknown } | { ok: false; error: string };

/** The `<lynx-view>` surface we drive (structural — no upstream type dep). */
export interface LynxViewLike {
  onNativeModulesCall?: (name: string, data: unknown, moduleName: string) => unknown;
  globalProps?: Record<string, unknown>;
  updateGlobalProps?: (data: Record<string, unknown>) => void;
  sendGlobalEvent?: (name: string, params: unknown[]) => void;
}

export interface InstallSigxWebHostOptions {
  /** Skip the appearance globalProps/event publisher. */
  appearance?: boolean;
  /** Skip the inbound-linking (initialURL / urlReceived) publisher. */
  linking?: boolean;
}

type Handler = (data: unknown) => unknown | Promise<unknown>;

function ok(value?: unknown): HostResponse {
  return { ok: true, value };
}
function fail(error: unknown): HostResponse {
  return { ok: false, error: error instanceof Error ? error.message : String(error) };
}

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

const OPENABLE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:', 'sms:'];

/** Picked-file description returned to the worker (blob URLs are fetchable there). */
interface PickedFile {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
  width?: number;
  height?: number;
}

async function describeFile(file: File): Promise<PickedFile> {
  const out: PickedFile = {
    uri: URL.createObjectURL(file),
    name: file.name,
    size: file.size,
    mimeType: file.type,
  };
  if (file.type.startsWith('image/')) {
    try {
      const bmp = await createImageBitmap(file);
      out.width = bmp.width;
      out.height = bmp.height;
      bmp.close();
    } catch {
      /* not decodable — dimensions stay undefined */
    }
  }
  return out;
}

/** `<input type=file>` picker; resolves `[]` on cancel. */
function pickFiles(accept: string | undefined, multiple: boolean): Promise<PickedFile[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.appendChild(input);
    const page = globalThis as {
      addEventListener?: (t: string, fn: () => void) => void;
      removeEventListener?: (t: string, fn: () => void) => void;
    };
    let settled = false;
    const done = (files: File[]): void => {
      if (settled) return; // change / cancel / focus-fallback race — first wins
      settled = true;
      page.removeEventListener?.('focus', onFocus);
      input.remove();
      Promise.all(files.map(describeFile)).then(resolve, reject);
    };
    // Focus-based cancel fallback for browsers that don't dispatch the
    // (newer) `cancel` event on file inputs: closing the dialog refocuses the
    // window with no `change`; the grace delay lets a real `change` win.
    const onFocus = (): void => {
      setTimeout(() => done([...(input.files ?? [])]), 300);
    };
    input.addEventListener('change', () => done([...(input.files ?? [])]), { once: true });
    input.addEventListener('cancel', () => done([]), { once: true });
    page.addEventListener?.('focus', onFocus);
    input.click();
  });
}

function buildHandlers(): Record<string, Handler> {
  return {
    'clipboard.setString': async (data) => {
      await navigator.clipboard.writeText(String(asRecord(data)['value'] ?? ''));
    },
    'clipboard.getString': async () => {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return ''; // permission denied / unsupported read — empty, don't throw
      }
    },
    'clipboard.hasString': async () => {
      try {
        return (await navigator.clipboard.readText()).length > 0;
      } catch {
        return false;
      }
    },
    'linking.openURL': (data) => {
      const url = String(asRecord(data)['url'] ?? '');
      const scheme = new URL(url, location.href).protocol;
      if (!OPENABLE_SCHEMES.includes(scheme)) {
        throw new Error(`URL scheme "${scheme}" cannot be opened in a browser`);
      }
      window.open(url, '_blank', 'noopener');
    },
    'linking.canOpenURL': (data) => {
      try {
        const url = String(asRecord(data)['url'] ?? '');
        return OPENABLE_SCHEMES.includes(new URL(url, location.href).protocol);
      } catch {
        return false;
      }
    },
    'share.isAvailable': () => typeof navigator.share === 'function',
    'share.share': async (data) => {
      const d = asRecord(data);
      if (typeof navigator.share !== 'function') {
        throw new Error('navigator.share is not supported in this browser');
      }
      await navigator.share({
        title: d['title'] as string | undefined,
        text: d['message'] as string | undefined,
        url: d['url'] as string | undefined,
      });
    },
    'picker.pick': (data) => {
      const d = asRecord(data);
      return pickFiles(d['accept'] as string | undefined, d['multiple'] === true);
    },
    'haptics.vibrate': (data) => {
      // Best-effort (Chromium only); never throws — mirrors the Haptics contract.
      const pattern = asRecord(data)['pattern'];
      (navigator as { vibrate?: (p: number | number[]) => boolean }).vibrate?.(
        (pattern as number | number[] | undefined) ?? 10,
      );
    },
    'location.getCurrent': (data) => {
      const d = asRecord(data);
      return getPosition({
        enableHighAccuracy: d['accuracy'] === 'high',
        timeout: typeof d['timeout'] === 'number' ? d['timeout'] : undefined,
      });
    },
    'location.permissionStatus': () => geoPermissionStatus(),
    'location.requestPermission': async () => {
      // The browser has no standalone geolocation prompt — a position request
      // IS the prompt. Ask (cheaply), then report the resulting status.
      try {
        await getPosition({ enableHighAccuracy: false, timeout: 30_000 });
        return { status: 'granted', canAskAgain: true };
      } catch {
        return geoPermissionStatus();
      }
    },
  };
}

interface HostPermissionResponse {
  status: 'granted' | 'denied' | 'undetermined' | 'blocked';
  canAskAgain: boolean;
}

/** Map the Permissions API state onto the package's PermissionResponse shape. */
async function geoPermissionStatus(): Promise<HostPermissionResponse> {
  try {
    const p = await navigator.permissions.query({ name: 'geolocation' });
    if (p.state === 'granted') return { status: 'granted', canAskAgain: true };
    // A browser denial sticks until the user flips the site setting — there
    // is no re-prompt, so it maps to 'blocked' rather than 'denied'.
    if (p.state === 'denied') return { status: 'blocked', canAskAgain: false };
    return { status: 'undetermined', canAskAgain: true };
  } catch {
    return { status: 'undetermined', canAskAgain: true };
  }
}

/** Promisified getCurrentPosition mapped to the lynx-location result shape. */
function getPosition(opts: PositionOptions): Promise<{
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('geolocation is not available in this browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = pos.coords;
        resolve({
          latitude: c.latitude,
          longitude: c.longitude,
          altitude: c.altitude ?? null,
          accuracy: c.accuracy,
          speed: c.speed ?? null,
          heading: c.heading ?? null,
          timestamp: pos.timestamp,
        });
      },
      (err) => reject(new Error(`geolocation failed: ${err.message}`)),
      opts,
    );
  });
}

function currentColorScheme(): 'dark' | 'light' {
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Wire a `<lynx-view>` for SignalX web support. Call once, as early as
 * possible (web-core caches `bridge.call`s made before the handler lands,
 * and `globalProps` should be set before the card loads). Returns an
 * uninstall function (removes page listeners; the handler stays — web-core
 * has no unassignment contract).
 */
export function installSigxWebHost(
  lynxView: LynxViewLike,
  options: InstallSigxWebHostOptions = {},
): () => void {
  const handlers = buildHandlers();
  const previous = lynxView.onNativeModulesCall;

  lynxView.onNativeModulesCall = (name: string, data: unknown, moduleName: string): unknown => {
    // Delegate non-sigx calls with the element as receiver — web-core invokes
    // the handler as a method on <lynx-view>, so a `this`-using previous
    // handler must keep its binding.
    if (!name.startsWith('sigx.')) return previous?.call(lynxView, name, data, moduleName);
    const handler = handlers[name.slice('sigx.'.length)];
    if (!handler) {
      return fail(`[@sigx/lynx-web-host] no handler for "${name}"`);
    }
    try {
      const result = handler(data);
      return result instanceof Promise ? result.then(ok, fail) : ok(result);
    } catch (e) {
      return fail(e);
    }
  };

  const cleanups: Array<() => void> = [];

  // ── Appearance publisher ────────────────────────────────────────────────
  if (options.appearance !== false) {
    const publish = (scheme: 'dark' | 'light'): void => {
      lynxView.updateGlobalProps?.({ appearance: { colorScheme: scheme } });
      lynxView.sendGlobalEvent?.('appearanceChanged', [{ colorScheme: scheme }]);
    };
    lynxView.globalProps = {
      ...lynxView.globalProps,
      appearance: { colorScheme: currentColorScheme() },
    };
    const mql = matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => publish(e.matches ? 'dark' : 'light');
    mql.addEventListener('change', onChange);
    cleanups.push(() => mql.removeEventListener('change', onChange));
  }

  // ── Inbound-linking publisher ───────────────────────────────────────────
  if (options.linking !== false) {
    lynxView.globalProps = { ...lynxView.globalProps, initialURL: location.href };
    const onUrl = (): void => {
      lynxView.sendGlobalEvent?.('urlReceived', [location.href]);
    };
    // Bare-global access (a browser page); optional-chained so importing this
    // module in a non-window context (tests, SSR scans) can't throw.
    const page = globalThis as {
      addEventListener?: (t: string, fn: () => void) => void;
      removeEventListener?: (t: string, fn: () => void) => void;
    };
    page.addEventListener?.('popstate', onUrl);
    page.addEventListener?.('hashchange', onUrl);
    cleanups.push(() => {
      page.removeEventListener?.('popstate', onUrl);
      page.removeEventListener?.('hashchange', onUrl);
    });
  }

  return () => {
    for (const c of cleanups) c();
  };
}
