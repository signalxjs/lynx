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
  shadowRoot?:
    | ({ adoptedStyleSheets: CSSStyleSheet[] } & Partial<EventTarget>)
    | null;
  /** web-core's SystemInfo override (`browser-config` attribute / property). */
  browserConfig?: SigxBrowserConfig;
  getBoundingClientRect?: () => { width: number; height: number };
  hasAttribute?: (name: string) => boolean;
}

/** web-core's `BrowserConfig` — the fields that override its `SystemInfo`. */
export interface SigxBrowserConfig {
  pixelRatio: number;
  pixelWidth: number;
  pixelHeight: number;
}

export interface InstallSigxWebHostOptions {
  /** Skip the appearance globalProps/event publisher. */
  appearance?: boolean;
  /** Skip the inbound-linking (initialURL / urlReceived) publisher. */
  linking?: boolean;
  /** Skip the `x-text { color: inherit }` native-parity style (see install). */
  textColorInheritance?: boolean;
  /** Skip the viewport `browser-config` override (see `viewportBrowserConfig`). */
  viewport?: boolean;
  /** Skip honoring `ignore-focus` on web (keeps a mousedown from blurring the editor). */
  ignoreFocus?: boolean;
}

/**
 * SystemInfo override describing the **`<lynx-view>` viewport**, in the shape
 * web-core's `browser-config` expects.
 *
 * Upstream fills `SystemInfo.pixelWidth/pixelHeight` from
 * `window.screen.availWidth/availHeight × devicePixelRatio` — the physical
 * *display*, not the element the app is rendered into. Everything that treats
 * SystemInfo as "the screen the app occupies" is then wrong by the ratio
 * between the two: `@sigx/lynx-navigation` slides cards in from
 * `SCREEN_WIDTH` px away and rests sheets at a fraction of `SCREEN_HEIGHT`
 * (a sheet could settle entirely below the visible area — #759),
 * `@sigx/lynx-gestures`' Swiper falls back to it for page width, and
 * `Platform.isPad` reads it. On native those values already *are* the app's
 * window, so overriding them on web restores parity rather than inventing a
 * new concept.
 *
 * `createSystemInfo` spreads `browserConfig` **after** its own values, so this
 * wins. It is read once when the `LynxViewInstance` is constructed, so it must
 * be set before the view starts loading its template — `sigx run:web`'s
 * generated host page sets the attribute inline during parsing, and
 * `installSigxWebHost` fills it in for embedders that haven't. Resizes are not
 * tracked (SystemInfo is frozen at construction).
 */
export function viewportBrowserConfig(view?: LynxViewLike): SigxBrowserConfig | null {
  // Read through globalThis, not bare identifiers: this module is also
  // imported in non-DOM contexts (tests, SSR scans) where they don't exist.
  const page = globalThis as {
    devicePixelRatio?: number;
    innerWidth?: number;
    innerHeight?: number;
  };
  const dpr = typeof page.devicePixelRatio === 'number' && page.devicePixelRatio > 0
    ? page.devicePixelRatio
    : 1;
  // A zero-sized box means "not laid out yet" — fall back to the page
  // viewport, which is what a default full-bleed `<lynx-view>` fills anyway.
  const box = view?.getBoundingClientRect?.();
  const width = box && box.width > 0 ? box.width : page.innerWidth;
  const height = box && box.height > 0 ? box.height : page.innerHeight;
  if (!width || !height) return null; // nothing measurable — leave SystemInfo alone
  return {
    pixelRatio: dpr,
    pixelWidth: Math.round(width * dpr),
    pixelHeight: Math.round(height * dpr),
  };
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

interface WebNotification {
  close(): void;
}

interface NotificationCtor {
  new (title: string, options?: { body?: string; tag?: string }): WebNotification;
  permission: 'granted' | 'denied' | 'default';
  requestPermission(): Promise<'granted' | 'denied' | 'default'>;
}

const REPEAT_MS: Record<string, number> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
};

/**
 * Local-notification state + handlers (page-lifetime, best-effort — timers
 * and repeats don't survive a reload; that limitation is documented in the
 * lynx-notifications README's Web section).
 */
function makeNotificationHandlers() {
  const scheduled = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval>; shown: WebNotification[] }
  >();
  let nextId = 1;
  let badge = 0;

  const ctor = (): NotificationCtor => {
    const n = (globalThis as { Notification?: NotificationCtor }).Notification;
    if (!n) throw new Error('the Notification API is not available in this browser');
    return n;
  };
  const mapPermission = (
    state: 'granted' | 'denied' | 'default',
  ): { status: string; canAskAgain: boolean } =>
    state === 'granted'
      ? { status: 'granted', canAskAgain: true }
      : state === 'denied'
        ? { status: 'blocked', canAskAgain: false } // site-settings change required
        : { status: 'undetermined', canAskAgain: true };

  return {
    schedule(d: Record<string, unknown>): string {
      const N = ctor();
      if (N.permission !== 'granted') {
        throw new Error('notification permission not granted — call requestPermission() first');
      }
      const id = `web-${nextId++}`;
      const title = String(d['title'] ?? '');
      const body = String(d['body'] ?? '');
      const delayMs = (typeof d['delay'] === 'number' ? d['delay'] : 0) * 1000;
      const repeatMs = REPEAT_MS[String(d['repeat'] ?? '')];
      const entry: { timer: ReturnType<typeof setTimeout>; interval?: ReturnType<typeof setInterval>; shown: WebNotification[] } = {
        timer: 0 as unknown as ReturnType<typeof setTimeout>,
        shown: [],
      };
      // Timer callbacks run after the RPC handler returned — a constructor
      // failure there (revoked permission, insecure context) would otherwise
      // be an unhandled error with a runaway repeat. Contain it and drop the
      // schedule.
      const show = (): void => {
        try {
          entry.shown.push(new N(title, { body, tag: id }));
        } catch {
          clearTimeout(entry.timer);
          if (entry.interval) clearInterval(entry.interval);
          scheduled.delete(id);
        }
      };
      entry.timer = setTimeout(() => {
        show();
        if (repeatMs && scheduled.has(id)) {
          entry.interval = setInterval(show, repeatMs);
        }
      }, delayMs);
      scheduled.set(id, entry);
      return id;
    },
    cancel(id: string): boolean {
      const entry = scheduled.get(id);
      if (!entry) return false;
      clearTimeout(entry.timer);
      if (entry.interval) clearInterval(entry.interval);
      for (const n of entry.shown) n.close();
      scheduled.delete(id);
      return true;
    },
    cancelAll(): boolean {
      for (const id of [...scheduled.keys()]) this.cancel(id);
      return true;
    },
    async requestPermission(): Promise<{ status: string; canAskAgain: boolean }> {
      return mapPermission(await ctor().requestPermission());
    },
    permissionStatus(): { status: string; canAskAgain: boolean } {
      return mapPermission(ctor().permission);
    },
    setBadge(count: number): void {
      badge = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
      // Badging API (installed PWAs, Chromium) — best-effort.
      const nav = navigator as { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      void (badge > 0 ? nav.setAppBadge?.(badge) : nav.clearAppBadge?.())?.catch(() => {});
    },
    getBadge(): number {
      return badge; // no portable read API — locally tracked, like Android's 0
    },
  };
}

function buildHandlers(): Record<string, Handler> {
  const notifs = makeNotificationHandlers();
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
    'notifications.schedule': (data) => notifs.schedule(asRecord(data)),
    'notifications.cancel': (data) => notifs.cancel(String(asRecord(data)['id'] ?? '')),
    'notifications.cancelAll': () => notifs.cancelAll(),
    'notifications.requestPermission': () => notifs.requestPermission(),
    'notifications.permissionStatus': () => notifs.permissionStatus(),
    'notifications.setBadge': (data) => notifs.setBadge(Number(asRecord(data)['count'] ?? 0)),
    'notifications.getBadge': () => notifs.getBadge(),
    'location.requestPermission': async () => {
      // The browser has no standalone geolocation prompt — a position request
      // IS the prompt. Ask (cheaply), then report the resulting status.
      try {
        await getPosition({ enableHighAccuracy: false, timeout: 30_000 });
        // Trust a decisive Permissions API answer; a one-time allow (or an
        // absent API) can still read 'prompt'/'undetermined' — the probe just
        // succeeded, so that means effectively granted.
        const s = await geoPermissionStatus();
        return s.status === 'granted' || s.status === 'blocked'
          ? s
          : { status: 'granted', canAskAgain: true };
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
    if (typeof navigator.geolocation?.getCurrentPosition !== 'function') {
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

  // ── Viewport SystemInfo override ────────────────────────────────────────
  // Only when the host page hasn't already supplied one: the generated page
  // sets `browser-config` inline while parsing (before the engine module
  // upgrades the element), which is strictly earlier than this call.
  if (
    options.viewport !== false &&
    !lynxView.browserConfig &&
    !lynxView.hasAttribute?.('browser-config')
  ) {
    const config = viewportBrowserConfig(lynxView);
    if (config) lynxView.browserConfig = config;
  }

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

  // ── Text-color inheritance parity ───────────────────────────────────────
  // Upstream web-core styles top-level text as `x-text { color: initial }`
  // (black), while the native engine lets text pick up the ancestor chain's
  // `color` — so themed apps (whose ThemeProvider sets `color` on its host)
  // render black-on-dark text on web only. Adopt a shadow-scope override so
  // web matches native. The shadow root attaches when the custom element
  // upgrades, which may be after install — retry briefly on rAF.
  // Constructed stylesheets only exist in real browsers — bail quietly in
  // non-DOM contexts (tests, SSR scans), same spirit as the page-listener
  // optional chaining below.
  if (
    options.textColorInheritance !== false &&
    typeof CSSStyleSheet !== 'undefined' &&
    typeof CSSStyleSheet.prototype.replaceSync === 'function'
  ) {
    let sheet: CSSStyleSheet | undefined;
    let cancelled = false;
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => void })
      .requestAnimationFrame;
    const adopt = (tries: number): void => {
      if (cancelled) return;
      const root = lynxView.shadowRoot;
      if (root) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync('x-text { color: inherit; }');
        root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
        return;
      }
      if (tries > 0 && raf) raf(() => adopt(tries - 1));
    };
    adopt(120); // ~2s at 60fps — the element upgrades long before this
    cleanups.push(() => {
      cancelled = true;
      const root = lynxView.shadowRoot;
      if (root && sheet) {
        root.adoptedStyleSheets = root.adoptedStyleSheets.filter((s) => s !== sheet);
      }
    });
  }

  // ── `ignore-focus` parity ───────────────────────────────────────────────
  // Native honors an element's `ignore-focus` attribute — tapping it (a
  // toolbar, a suggestion popup) does NOT move focus, so a text field stays
  // focused and its trigger/suggestion session survives the tap. web-core
  // doesn't translate the attribute, so on web a `mousedown` on such an element
  // blurs the `contenteditable` editor and closes the session before the tap's
  // `click` can act (the composer's mention popup: verified — the popup
  // unmounts on blur before `onSelect` fires). A capture-phase `mousedown`
  // `preventDefault` on any `[ignore-focus]` target keeps the focus where it
  // is; `click`/`bindtap` still fire, so the tap works.
  //
  // `mousedown` specifically: it's the focus-moving default for pointer input
  // and canceling it is the well-worn editor-toolbar trick (it does NOT
  // suppress `click`, unlike canceling `pointerdown`/`touchstart`, which would
  // kill the tap on touch). Touch focus management is a follow-up. The shadow
  // root attaches when the element upgrades — retry on rAF like the style
  // adoption above.
  if (options.ignoreFocus !== false) {
    let cancelled = false;
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => void })
      .requestAnimationFrame;
    const onMouseDown = (e: Event): void => {
      const target = e.target as
        | { closest?: (sel: string) => unknown; isContentEditable?: boolean }
        | null;
      if (!target?.closest?.('[ignore-focus]')) return;
      // Preserve focus by canceling the mousedown — UNLESS the target itself
      // legitimately wants focus. `ignore-focus` marks a container ("tapping me
      // doesn't move focus"), but a focusable descendant still may: the
      // composer wraps its input ROW in `ignore-focus`, and the editable field
      // lives inside it. Canceling there would stop the editor from focusing
      // (no caret, no typing). So skip a contenteditable / input / focusable.
      if (
        target.isContentEditable ||
        target.closest('input, textarea, select, [contenteditable], [tabindex]')
      ) {
        return;
      }
      e.preventDefault();
    };
    const attach = (tries: number): void => {
      if (cancelled) return;
      const root = lynxView.shadowRoot as (Partial<EventTarget> & object) | null | undefined;
      if (root?.addEventListener) {
        root.addEventListener('mousedown', onMouseDown, true);
        cleanups.push(() => root.removeEventListener?.('mousedown', onMouseDown, true));
        return;
      }
      if (tries > 0 && raf) raf(() => attach(tries - 1));
    };
    attach(120);
    cleanups.push(() => {
      cancelled = true;
    });
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
