# @sigx/lynx-video

Native video player component for sigx-lynx. iOS uses `AVPlayer` + `AVPlayerLayer`; Android uses `androidx.media3` (`ExoPlayer` + `PlayerView`).

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/video/overview/](https://sigx.dev/lynx/modules/video/overview/)**

Registers a `<video-player>` JSX intrinsic that participates in Lynx's layout tree. The typed `<VideoPlayer>` wrapper is the recommended entry point.

## Install

```bash
pnpm add @sigx/lynx-video
```

`sigx prebuild` auto-discovers the package, registers the `<video-player>` UI element on both platforms, and pulls in the `media3` Gradle deps on Android.

## Usage

```tsx
import { VideoPlayer } from '@sigx/lynx-video';

function ClipScreen() {
    return () => (
        <VideoPlayer
            src="https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
            autoplay
            controls
            resizeMode="contain"
            onLoad={(e) => console.log('loaded', e.detail.durationMs)}
            onEnd={() => console.log('done')}
            onError={(e) => console.warn(e.detail.message)}
            style={{ width: '100%', aspectRatio: 16 / 9 }}
        />
    );
}
```

## API

### `<VideoPlayer>` props

| Prop          | Type                                  | Notes                                                  |
| ------------- | ------------------------------------- | ------------------------------------------------------ |
| `src`         | `string`                              | URL or `file://` URI. Setting reloads the player.      |
| `poster`      | `string?`                             | Image to display before the first frame.               |
| `autoplay`    | `boolean?`                            | Begin playback as soon as the asset is ready.          |
| `playing`     | `boolean?`                            | Drive play/pause declaratively. Re-renders flip state. |
| `loop`        | `boolean?`                            | Restart automatically at end-of-clip.                  |
| `muted`       | `boolean?`                            | Mute audio output.                                     |
| `volume`      | `number?`                             | 0..1. Independent of `muted`.                          |
| `controls`    | `boolean?`                            | Show platform-default playback controls.               |
| `resizeMode`  | `'contain' \| 'cover' \| 'stretch'`   | Default `'contain'`.                                   |
| `onLoad`      | `(e) => void`                         | `detail: { durationMs, width, height }`                |
| `onEnd`       | `(e) => void`                         | Playback reached end of clip.                          |
| `onError`     | `(e) => void`                         | `detail: { message }`                                  |
| `onTimeUpdate`| `(e) => void`                         | ~4×/sec. `detail: { positionMs }`                      |

## Gotchas

- **Imperative methods** (`seek(s)`, `getStatus()`) are tracked as a v2 follow-up — they need Lynx's `UIMethodInvoker` surface, which isn't wired through sigx-lynx yet (same blocker that `WebView.goBack` and `Map.animateToRegion` are waiting on). For now, drive the player declaratively via `playing` / `src` props.
- **App Transport Security (iOS)** — playing an `http://` (non-HTTPS) URL requires an `NSAppTransportSecurity` exception in your app's `Info.plist`. The package itself does not relax ATS.
- **Android media3 versions** — pinned to `1.4.1`. If your app already depends on a different `media3` version, align it via Gradle resolution to avoid duplicate-class errors.
- **AudioSession (iOS)** — when playing audio-bearing video, this component sets `AVAudioSession` to `.playback`. Apps that also use `@sigx/lynx-audio` get a separate session ref-count.
