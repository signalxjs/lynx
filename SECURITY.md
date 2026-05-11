# Security Policy

## Supported versions

SignalX is in early public release. Security fixes are applied to the latest `0.4.x` line.

| Version | Supported |
|---------|-----------|
| `0.4.x` | ✅        |
| `< 0.4` | ❌        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security problems.**

Use one of the following private channels:

1. **GitHub Security Advisories** — preferred. Open a private report at
   <https://github.com/signalxjs/lynx/security/advisories/new>.
2. **Email** — contact the maintainer directly. See the `author` field in
   [`package.json`](./package.json) and the GitHub profile linked from there.

Please include:

- A description of the issue and its impact.
- Steps to reproduce, ideally a minimal proof of concept.
- Affected package(s) and version(s).
- Any suggested mitigation, if you have one.

## Response

- We aim to acknowledge new reports within a few business days.
- Once a fix is ready, a patched version will be published to npm and a
  security advisory will be posted on GitHub crediting the reporter
  (unless they prefer to remain anonymous).
