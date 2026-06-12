/**
 * `RTCDataChannel` — W3C-shaped data channel over the native module.
 *
 * Text messages cross the bridge as-is; binary is base64-encoded both
 * ways (`binaryType` is `'arraybuffer'` only, like the rest of the
 * runtime — there is no Blob).
 */
import { arrayBufferToBase64, base64ToArrayBuffer, callAsync } from '@sigx/lynx-core';
import {
    MODULE,
    type NativeEvent,
    type RTCEventLike,
    RTCEventTargetBase,
    registerDispatcher,
    unregisterDispatcher,
    unwrap,
} from './events.js';
import type { RTCDataChannelInit, RTCDataChannelState } from './types.js';

export class RTCDataChannel extends RTCEventTargetBase {
    readonly label: string;
    readonly ordered: boolean;
    readonly protocol: string;
    binaryType = 'arraybuffer' as const;
    /**
     * Approximated as bytes handed to the bridge — native does not ack
     * flushes, so this is a write-through counter (same caveat as
     * `WebSocket.bufferedAmount`).
     */
    bufferedAmount = 0;

    onopen: ((ev: RTCEventLike) => void) | null = null;
    onmessage: ((ev: RTCEventLike) => void) | null = null;
    onclose: ((ev: RTCEventLike) => void) | null = null;
    onerror: ((ev: RTCEventLike) => void) | null = null;

    /** @internal native registry handle (positive = created here, negative = remote-created). */
    readonly _handle: number;
    private _readyState: RTCDataChannelState;
    private _sctpId: number | null;

    /** @internal — use `RTCPeerConnection.createDataChannel()`; remote channels come from `ondatachannel`. */
    constructor(
        handle: number,
        label: string,
        init: RTCDataChannelInit,
        opts: { state: RTCDataChannelState; sctpId?: number | null },
    ) {
        super();
        this._handle = handle;
        this.label = label;
        this.ordered = init.ordered ?? true;
        this.protocol = init.protocol ?? '';
        this._readyState = opts.state;
        this._sctpId = opts.sctpId ?? null;
        registerDispatcher(handle, evt => this._dispatch(evt));
    }

    /** SCTP stream id — null until the channel opens. */
    get id(): number | null {
        return this._sctpId;
    }

    get readyState(): RTCDataChannelState {
        return this._readyState;
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (this._readyState === 'connecting') {
            throw new Error('InvalidStateError: RTCDataChannel is still connecting.');
        }
        if (this._readyState !== 'open') {
            // Browsers throw here too; mirror them rather than dropping silently.
            throw new Error(`InvalidStateError: RTCDataChannel is ${this._readyState}.`);
        }

        let isBinary = false;
        let payload: string;
        if (typeof data === 'string') {
            payload = data;
        } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            isBinary = true;
            payload = arrayBufferToBase64(data);
        } else {
            throw new TypeError('RTCDataChannel.send: unsupported data type');
        }

        this.bufferedAmount += isBinary ? base64ByteLength(payload) : utf8ByteLength(payload);

        // unwrap surfaces the `{ error }` callback convention as a rejection
        // so resolved native failures dispatch an error event too.
        callAsync(MODULE, 'dcSend', this._handle, payload, isBinary)
            .then(unwrap)
            .catch(err => {
                this._dispatch({
                    id: this._handle,
                    type: 'dcerror',
                    message: err instanceof Error ? err.message : String(err),
                });
            });
    }

    close(): void {
        if (this._readyState === 'closing' || this._readyState === 'closed') return;
        this._readyState = 'closing';
        callAsync(MODULE, 'dcClose', this._handle)
            .then(unwrap)
            .catch(() => {
                // Close failed natively — settle locally so we don't hang in 'closing'.
                this._dispatch({ id: this._handle, type: 'dcclose' });
            });
    }

    /** @internal — close without a native round-trip (peer.close()). */
    _closeLocally(): void {
        this._dispatch({ id: this._handle, type: 'dcclose' });
    }

    private _dispatch(evt: NativeEvent): void {
        switch (evt.type) {
            case 'dcopen': {
                if (this._readyState !== 'connecting') return;
                this._readyState = 'open';
                if (typeof evt.sctpId === 'number') this._sctpId = evt.sctpId;
                this._emit('open', { type: 'open', target: this, currentTarget: this });
                break;
            }
            case 'dcmessage': {
                if (this._readyState !== 'open') return;
                let data: string | ArrayBuffer;
                if (evt.isBinary && typeof evt.binary === 'string') {
                    data = base64ToArrayBuffer(evt.binary);
                } else {
                    data = evt.data ?? '';
                }
                this._emit('message', { type: 'message', target: this, currentTarget: this, data });
                break;
            }
            case 'dcerror': {
                this._emit('error', {
                    type: 'error',
                    target: this,
                    currentTarget: this,
                    message: evt.message,
                });
                break;
            }
            case 'dcclose': {
                if (this._readyState === 'closed') return;
                this._readyState = 'closed';
                unregisterDispatcher(this._handle);
                this._emit('close', { type: 'close', target: this, currentTarget: this });
                break;
            }
        }
    }
}

// Byte-length helpers (kept local to avoid a dep on string encoding APIs).

function utf8ByteLength(s: string): number {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) {
            n += 4;
            i++; // surrogate pair
        } else n += 3;
    }
    return n;
}

function base64ByteLength(b64: string): number {
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return ((b64.length * 3) >> 2) - padding;
}
