# @sigx/lynx-audio

Audio recording and playback for sigx-lynx. iOS uses `AVAudioPlayer` / `AVAudioRecorder`; Android uses `MediaPlayer` / `MediaRecorder`.

## Install

```bash
pnpm add @sigx/lynx-audio
```

`sigx prebuild` auto-discovers the package, links the native module, injects `android.permission.RECORD_AUDIO`, adds `NSMicrophoneUsageDescription` to `Info.plist`, and enables the `audio` background mode for iOS.

> **Android requires `@sigx/lynx-permissions`** — `RECORD_AUDIO` is requested through `PermissionHelper`. Install it explicitly: `pnpm add @sigx/lynx-permissions`.

## Playback

```ts
import { Audio } from '@sigx/lynx-audio';

const handle = await Audio.play('file:///path/to/clip.m4a', { volume: 1, loop: false });
handle.onEnd(() => console.log('done'));

await handle.pause();
await handle.resume();
await handle.seek(2.5);
await handle.stop();
```

Each `Audio.play()` allocates its own native player, so multiple handles can play concurrently (background music + UI sound effects, for example).

## Recording

```ts
import { Audio } from '@sigx/lynx-audio';

const perm = await Audio.requestPermission();
if (perm.status !== 'granted') return;

const rec = await Audio.startRecording({ format: 'm4a', sampleRate: 44100 });
rec.onMeter(({ peak, avg }) => /* update VU meter */);

// later
const { uri, durationMs, sizeBytes } = await rec.stop();
```

## API

| Method                                                | Notes                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Audio.play(uri, options?)`                           | Allocates a new player. Returns an `AudioHandle`.                                           |
| `Audio.preload(uri)`                                  | Decodes the file and returns `{ durationMs }`. Useful to avoid first-play latency.          |
| `Audio.startRecording(options?)`                      | Returns a `RecordingHandle`. One recording at a time per process.                           |
| `Audio.requestPermission()`                           | Shows the OS microphone dialog if needed.                                                   |
| `Audio.getPermissionStatus()`                         | Read-only check — no prompt.                                                                |
| `Audio.isAvailable()`                                 | Whether the native module is registered.                                                    |

```ts
interface PlayOptions {
    volume?: number;    // 0..1
    loop?: boolean;
    rate?: number;      // playback rate, 1 = normal
}

interface AudioHandle {
    pause(): Promise<void>;
    resume(): Promise<void>;
    stop(): Promise<void>;
    seek(seconds: number): Promise<void>;
    setVolume(v: number): Promise<void>;
    getStatus(): Promise<PlayerStatus>;
    onEnd(cb: () => void): () => void;   // unsubscribe
}

interface RecordOptions {
    outputPath?: string;            // default: temp dir
    format?: 'm4a' | 'wav';         // default 'm4a'
    sampleRate?: number;            // default 44100
    channels?: 1 | 2;               // default 1
}

interface RecordingHandle {
    pause(): Promise<void>;
    resume(): Promise<void>;
    stop(): Promise<{ uri: string; durationMs: number; sizeBytes: number }>;
    onMeter(cb: (m: { peak: number; avg: number }) => void): () => void;
}
```

## Gotchas

- **iOS AudioSession** is managed internally — the module flips to `.playback` while a player is alive, `.playAndRecord` while recording, and deactivates when nothing is active. Apps that need custom mixing categories should pause this module's sessions or wait for an explicit `setCategory` API.
- **`stop()` resolves with metadata** (`uri`, `durationMs`, `sizeBytes`) — don't discard the return value if you need the file.
- **iOS simulator microphone** is the host Mac's mic; ensure mic permissions are granted to Simulator in System Settings.
