# @sigx/lynx-markdown

Typed SignalX wrapper around Lynx's `<x-markdown>` XElement.

## Status

**Pre-release** — the wrapper compiles and types cleanly today, but the
underlying native element ships per-platform on different schedules:

| Platform | First version  | Notes                                          |
| -------- | -------------- | ---------------------------------------------- |
| Harmony  | Lynx 3.7.0     | Stable.                                        |
| Android  | Lynx 3.8.0-rc.0 | Ships as `org.lynxsdk.lynx:lynx_xelement_markdown`. |
| iOS      | (post-3.8.0)   | Currently only on the upstream `main` branch.  |

On platforms where `<x-markdown>` is not yet registered, the component
renders nothing at runtime. This package exists so that app code can
already adopt the typed API surface — once you bump SignalX's Lynx pins
to a release that includes the native element on your target platforms,
it starts rendering without code changes.

When the iOS/Android pods land in stable, this README will be updated
with the matching native dependency wiring (Podfile + gradle).

## Install

```
pnpm add @sigx/lynx-markdown
```

## Use

```tsx
import { Markdown } from '@sigx/lynx-markdown';

export default function ArticleScreen() {
  return (
    <Markdown
      value={"# Hello\n\nThis is **markdown**."}
      effect="typewriter"
      onLink={(e) => console.log('tapped', e.detail.url)}
      onParseEnd={() => console.log('parsed')}
    />
  );
}
```

## Props

| Prop          | Type                                    | Notes                                               |
| ------------- | --------------------------------------- | --------------------------------------------------- |
| `value`       | `string`                                | Markdown source passed as a raw-text child.         |
| `effect`      | `'typewriter' \| 'none' \| string`      | Maps to the `markdown-effect` attribute.            |
| `attachments` | `ReadonlyArray<unknown>`                | Maps to `text-mark-attachments`. Engine-defined.    |
| `class`       | `string`                                |                                                      |
| `style`       | `string \| Record<string, ...>`         |                                                      |
| `onLink`      | `(e: MarkdownLinkEvent) => void`        | Underlying `bindlink`.                              |
| `onImageTap`  | `(e: MarkdownImageTapEvent) => void`    | Underlying `bindimageTap`.                          |
| `onParseEnd`  | `(e: MarkdownParseEndEvent) => void`    | Underlying `bindparseEnd`.                          |

## Native element methods

The underlying `<x-markdown>` exposes UI methods you can invoke via a
`main-thread:ref`:

- `getContent`, `getParseResult`, `getImages`
- `pauseAnimation`, `resumeAnimation`, `clearStatus`
- `getTextBoundingRect`, `setTextSelection`, `getSelectedText`

These are not yet wrapped by the component; drop down to the intrinsic
`<x-markdown>` element with a ref to call them directly.
