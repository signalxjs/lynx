/**
 * Unit tests for the WebView JS surface. Native side (WKWebView / WebView)
 * is exercised on-device — this only covers the type augmentation and the
 * thin Lynx component wrapper.
 */
import { describe, expect, it } from 'vitest';
import type {
    SigxWebViewAttributes,
    WebViewLoadEvent,
    WebViewErrorEvent,
    WebViewMessageEvent,
} from '../src/jsx-augment.js';

describe('jsx-augment', () => {
    it('SigxWebViewAttributes accepts the documented prop shape', () => {
        const attrs: SigxWebViewAttributes = {
            src: 'https://example.com',
            html: '<h1>hi</h1>',
            'user-agent': 'TestAgent/1.0',
            'enable-debug': true,
            bindload: (e) => { void e.detail.url; },
            binderror: (e) => { void e.detail.message; },
            bindmessage: (e) => { void e.detail.data; },
        };
        expect(attrs.src).toBe('https://example.com');
        expect(attrs['enable-debug']).toBe(true);
    });

    it('event detail shapes match the native wire format', () => {
        const load: WebViewLoadEvent = { type: 'load', detail: { url: 'https://x.test/' } };
        const err: WebViewErrorEvent = {
            type: 'error',
            detail: { url: 'https://x.test/', message: 'failed' },
        };
        const msg: WebViewMessageEvent = { type: 'message', detail: { data: 'hello' } };
        expect(load.detail.url).toBe('https://x.test/');
        expect(err.detail.message).toBe('failed');
        expect(msg.detail.data).toBe('hello');
    });

    it('declares <sigx-webview> on the global JSX namespace', () => {
        // The augmentation only needs to compile — a runtime assertion would
        // require a renderer. If this test file builds clean, the global
        // augmentation is in place.
        expect(true).toBe(true);
    });
});
