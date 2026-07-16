# @sigx/lynx-webauth

A system **web-auth session** for sigx-lynx — the right primitive for OAuth /
OpenID-Connect sign-in and account-connect flows.

It presents a secure browser sheet *over* your app (not an embedded WebView, so
Google, Microsoft, etc. don't reject it), shares the system browser's cookies
(users are often already signed in), and — when the provider redirects to your
app's scheme — hands the callback URL straight back to the awaited call and
dismisses itself. No global deep-link listener, no foreground polling.

- **iOS**: `ASWebAuthenticationSession` (`AuthenticationServices`).
- **Android**: Chrome **Custom Tabs** (`androidx.browser`), with the redirect
  captured through `@sigx/lynx-linking`'s incoming-URL pipeline.

## 📚 Documentation

Full guide, provider recipes, and the security model →
**[sigx.dev/lynx/modules/webauth/overview](https://sigx.dev/lynx/modules/webauth/overview/)**

## Install

```bash
pnpm add @sigx/lynx-webauth
```

`sigx prebuild` auto-discovers the package, links the native module, and (on
Android) adds the `androidx.browser` dependency.

The `callbackScheme` is your app's registered custom scheme — **the same one
Lynx already wires for `Linking`**. Set it once in `signalx.config.ts`:

```ts
export default defineLynxConfig({
    name: 'My App',
    scheme: 'myapp', // registers myapp:// on both platforms
});
```

## A taste

```ts
import { openAuthSession } from '@sigx/lynx-webauth';

const result = await openAuthSession(
    'https://provider.com/authorize?response_type=code&client_id=…&redirect_uri=myapp://cb',
    'myapp',
);

if (result.url) {
    const code = new URL(result.url).searchParams.get('code');
    // exchange `code` for tokens via your backend
} else if (result.canceled) {
    // user dismissed the sheet
} else {
    console.error(result.error);
}
```

Always resolves — cancellation and failures are normal resolved values
(`{ canceled: true }` / `{ error }`), never a thrown promise.

### Options

```ts
await openAuthSession(authorizeUrl, 'myapp', {
    ephemeral: true, // iOS: don't share/persist system-browser cookies (no SSO)
    toolbarColor: '#0088ff', // Android: Custom Tabs toolbar color
    preferredBrowserPackage: 'com.android.chrome', // Android: pin a browser
    signal: controller.signal, // abort the in-flight session
});
```

**`AbortSignal` note (Android):** Custom Tabs can't be force-dismissed
programmatically, so aborting settles the promise as `{ canceled: true }`
immediately; the system tab returns to the foreground on its own when the user
dismisses it. On iOS, abort dismisses the sheet directly.

## OAuth helpers (opt-in)

The core primitive is unopinionated — you parse the callback URL yourself. For
the common PKCE authorization-code flow, a small **opt-in** helper covers the
*frozen* parts of the spec (PKCE per RFC 7636, `state`, callback parsing). Token
exchange / refresh / OIDC discovery are intentionally out of scope — they're
provider-specific and belong in your app.

```ts
import { generatePKCE, generateState, parseCallback } from '@sigx/lynx-webauth/oauth';

const { verifier, challenge, method } = await generatePKCE(); // method: 'S256'
const state = generateState();

const authorizeUrl =
    `https://provider.com/authorize?response_type=code&client_id=…` +
    `&redirect_uri=myapp://cb&state=${state}` +
    `&code_challenge=${challenge}&code_challenge_method=${method}`;

const result = await openAuthSession(authorizeUrl, 'myapp');
if (result.url) {
    const { code, state: returned, error } = parseCallback(result.url);
    if (error) throw new Error(error);
    if (returned !== state) throw new Error('state mismatch');
    // POST { code, code_verifier: verifier } to your token endpoint
}
```

## License

MIT
