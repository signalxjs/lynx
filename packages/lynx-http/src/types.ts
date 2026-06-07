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
 * The buffered native implementation (#249) delivers the whole body as a
 * single `chunk`; the streaming one (#250) honors `streaming: true` and
 * emits one `chunk` per network read. The JS side is agnostic — it queues
 * chunks either way.
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
     * When true the native side MAY deliver the body incrementally as
     * multiple `chunk` events. The buffered implementation ignores the
     * flag and always sends one chunk; JS handles both identically.
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
