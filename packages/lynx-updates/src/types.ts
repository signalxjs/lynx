/**
 * Public types for `@sigx/lynx-updates` — the manifest shape, the pluggable
 * `UpdateProvider` backend contract, and the reactive state machine.
 */

export type UpdatePlatform = 'android' | 'ios';

/** A single published update, as resolved by a provider. */
export interface UpdateManifest {
    /**
     * Unique update identity. Content-addressed by convention:
     * `sha256.slice(0, 16)` (what `sigx updates:publish` emits).
     */
    id: string;
    /** Human-readable JS version, e.g. `'1.4.2'`. */
    version: string;
    /**
     * Native runtime fingerprint this bundle requires. Compared against the
     * installed binary's fingerprint — a mismatch means the update needs a
     * newer native build (store release) and is surfaced as `incompatible`.
     */
    runtimeVersion: string;
    /** URL of the `.lynx.bundle` artifact (absolute, or relative to the manifest URL). */
    bundleUrl: string;
    /** Hex SHA-256 of the bundle bytes — verified natively after download. */
    sha256: string;
    /** App is blocked (UI) and the update force-installed when true. */
    mandatory: boolean;
    /** ISO-8601 publish timestamp — newest wins during selection. */
    createdAt?: string;
    /** Free-form metadata surfaced to UI (e.g. `releaseNotes`). */
    metadata?: Record<string, string>;
}

/** Client context handed to providers on every check. */
export interface UpdateCheckContext {
    platform: UpdatePlatform;
    /** Installed binary's native fingerprint (authoritative, from the native module). */
    runtimeVersion: string;
    /** Id of the currently running OTA update, or null when on the embedded bundle. */
    currentUpdateId: string | null;
    /** Version of the embedded (store-shipped) bundle. */
    embeddedVersion: string;
    /** Release channel, when configured. */
    channel: string | undefined;
}

export type UpdateCheckResult =
    | { type: 'update-available'; manifest: UpdateManifest }
    | { type: 'up-to-date' }
    /** Provider found an update but its runtimeVersion doesn't match this binary. */
    | { type: 'incompatible'; manifest: UpdateManifest };

/** How the bundle bytes should be fetched (always downloaded natively). */
export interface DownloadSpec {
    url: string;
    sha256: string;
    headers?: Record<string, string>;
}

/**
 * Pluggable update backend. The built-in {@link StaticManifestProvider}
 * covers static-host JSON manifests; protocol backends (auth, signed
 * manifests, Expo Updates protocol, …) implement this interface in their own
 * package — no core changes needed.
 */
export interface UpdateProvider {
    readonly name: string;
    /**
     * Resolve the best available update for this client, or up-to-date.
     * Providers SHOULD pre-filter on `ctx.platform`, `ctx.channel` and
     * `ctx.runtimeVersion`; core re-validates `runtimeVersion` and downgrades
     * a mismatch to `{ type: 'incompatible' }` regardless.
     */
    checkForUpdate(ctx: UpdateCheckContext): Promise<UpdateCheckResult>;
    /**
     * Optional: customize how the bundle is fetched (auth headers, signed
     * URLs, alternate CDN). Default: `{ url: manifest.bundleUrl, sha256:
     * manifest.sha256 }`. The byte transfer + SHA-256 verification always
     * happen natively (streamed to disk, never through the JS bridge).
     */
    resolveDownload?(manifest: UpdateManifest, ctx: UpdateCheckContext): Promise<DownloadSpec>;
}

// ── State machine ──────────────────────────────────────────────────────────

export type UpdateStatus =
    | 'idle'
    | 'checking'
    | 'up-to-date'
    | 'available'
    | 'incompatible'
    | 'downloading'
    | 'ready'
    | 'applying'
    | 'error';

export interface DownloadProgress {
    receivedBytes: number;
    /** null when the server sent no Content-Length. */
    totalBytes: number | null;
}

/** What this process is actually running, as reported by the native module. */
export interface CurrentUpdateInfo {
    /** null → running the embedded (store-shipped) bundle. */
    updateId: string | null;
    version: string;
    runtimeVersion: string;
    isEmbedded: boolean;
    /** True on the first launch running a freshly applied update. */
    isFirstLaunchAfterUpdate: boolean;
    /** True when native rolled back because the previous launch never reached markReady. */
    didRollBack: boolean;
}

export interface UpdatesState {
    status: UpdateStatus;
    /** Set from `available` onward. */
    manifest: UpdateManifest | null;
    /** Non-null only while downloading. */
    progress: DownloadProgress | null;
    /** True → UI should block until the update is installed. */
    mandatory: boolean;
    error: UpdatesError | null;
    currentlyRunning: CurrentUpdateInfo;
}

export type UpdatesEvent =
    | { type: 'checkStarted' }
    | { type: 'upToDate' }
    | { type: 'updateAvailable'; manifest: UpdateManifest }
    /** An update exists but requires a newer native build (store release). */
    | { type: 'incompatibleUpdate'; manifest: UpdateManifest }
    | { type: 'downloadStarted'; manifest: UpdateManifest }
    | { type: 'downloadProgress'; progress: DownloadProgress }
    | { type: 'updateReady'; manifest: UpdateManifest }
    | { type: 'applying' }
    | { type: 'rolledBack'; fromUpdateId: string }
    | { type: 'error'; error: UpdatesError };

// ── Configuration ──────────────────────────────────────────────────────────

/**
 * - `'silent'`    — auto check + download; staged update applies on next
 *                   cold launch. (default)
 * - `'immediate'` — auto check + download, then `apply()` as soon as the
 *                   download is ready (in-place reload).
 * - `'manual'`    — nothing automatic; the app drives check/download/apply.
 */
export type UpdateMode = 'silent' | 'immediate' | 'manual';

export interface UpdatesConfig {
    /**
     * Provider instance, or shorthand for the built-in static-manifest
     * provider (`{ url }` → fetch that JSON manifest).
     */
    provider: UpdateProvider | { url: string; headers?: Record<string, string> };
    /** Release channel. Default: the baked `__SIGX_UPDATES_CHANNEL__` define (usually 'production'). */
    channel?: string;
    /** Update mode. Default `'silent'`. */
    mode?: UpdateMode;
    /** When to auto-check (ignored in `'manual'`). Default `['launch']`. */
    checkOn?: Array<'launch' | 'foreground'>;
    /**
     * Mandatory updates always block (`state.mandatory`) and auto-apply once
     * ready, in EVERY mode — including `'manual'` — unless this is false.
     * Default true.
     */
    honorMandatory?: boolean;
    /**
     * true (default): `markReady()` is called automatically shortly after
     * `configure()` — "JS booted" is the health bar for rollback. Set false
     * to gate on your own signal (first screen rendered, critical fetch OK)
     * and call `Updates.markReady()` yourself.
     */
    autoMarkReady?: boolean;
    /** Rollback tuning — persisted natively for subsequent launches. */
    rollback?: {
        /**
         * Launch attempts a pending update gets before native rolls back.
         * Default 2 (absorbs one user force-kill before markReady).
         */
        maxFailedLaunches?: number;
    };
}

export class UpdatesError extends Error {
    constructor(
        public readonly code:
            | 'check-failed'
            | 'download-failed'
            | 'hash-mismatch'
            | 'apply-failed'
            | 'runtime-mismatch'
            | 'not-configured'
            | 'native-unavailable',
        message: string,
    ) {
        super(message);
        this.name = 'UpdatesError';
    }
}
