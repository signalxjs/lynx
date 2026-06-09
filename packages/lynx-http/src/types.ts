/**
 * Wire shapes shared between the JS shim and the native `Http` module.
 *
 * THE BRIDGE PROTOCOL IS FROZEN — designed in full for both the upload
 * (#249) and streaming (#250) milestones so the second lands as a purely
 * additive native change:
 *
 *   NativeModules.Http.request(id, spec, cb)   // cb acks dispatch / sync failure
 *   NativeModules.Http.abort(id, cb)
 *
 * All real outcomes arrive as `__sigxHttpEvent` global events demuxed by
 * `id`, in this order:
 *
 *   response (once) → progress* (upload) → chunk* (body) → done | error
 *
 * Each event crosses the bridge as a single **JSON string** param (parsed
 * back to `NativeHttpEvent` by the shim). Native used to send a structured
 * map, but Lynx 0.5.0 / PrimJS 3.8 regressed `sendGlobalEvent` marshalling
 * of maps containing a nested map (the `response` event's `headers`),
 * silently dropping sibling scalars (`status`/`statusText`) — see #342. A
 * flat JSON string survives intact; the shim tolerates both shapes.
 *
 * Native honors `streaming: true` (#250) by emitting one `chunk` per
 * network read — `fetch` always requests it, so `res.body.getReader()`
 * sees bytes as they arrive (SSE renders incrementally). `streaming:
 * false` buffers the whole body into a single `chunk` on completion;
 * the JS side is agnostic — it queues chunks either way.
 */

export type NativeMultipartPart =
    | { kind: 'field'; name: string; value: string }
    /** File bytes NEVER cross the bridge — native streams from `uri`. */
    | { kind: 'file'; name: string; uri: string; filename: string; contentType: string };

export type NativeBody =
    | { type: 'none' }
    | { type: 'text'; text: string }
    | { type: 'base64'; data: string }
    | { type: 'multipart'; boundary: string; parts: NativeMultipartPart[] };

export interface NativeRequestSpec {
    url: string;
    method: string;
    headers: Record<string, string>;
    /**
     * When true the native side delivers the body incrementally as one
     * `chunk` event per network read; when false it buffers and sends a
     * single chunk on completion. JS handles both identically.
     */
    streaming: boolean;
    body: NativeBody;
}

export interface NativeHttpEvent {
    id: number;
    type: 'response' | 'chunk' | 'progress' | 'done' | 'error';
    /** response */
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    /** chunk — base64-encoded body bytes */
    data?: string;
    /** progress — upload bytes */
    loaded?: number;
    total?: number;
    /** error */
    message?: string;
}
