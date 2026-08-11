# @sigx/lynx-maps

Native map view for sigx-lynx. Backed by:

- **iOS** — `MKMapView` (Apple Maps, no key required).
- **Android** — `com.google.android.gms.maps.MapView` (Google Maps,
  requires an API key — see [setup](#android-api-key-setup) below).

## 📚 Documentation

Full guides, API reference and live examples → **[https://sigx.dev/lynx/modules/maps/overview/](https://sigx.dev/lynx/modules/maps/overview/)**

## Install

```bash
pnpm add @sigx/lynx-maps
pnpm sigx prebuild
```

The autolinker picks up `signalx-module.json` from this package; prebuild
regenerates `GeneratedBehaviors.kt` (Android) and
`GeneratedComponentRegistry.swift` (iOS) so the `<sigx-map>` and
`<sigx-map-marker>` tags are bound to their native UI classes.

## Usage

```tsx
import { Map, MapMarker } from '@sigx/lynx-maps';

const region = {
    latitude: 59.3293,
    longitude: 18.0686,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
};

export function MapScreen() {
    return (
        <Map
            region={region}
            showsUserLocation
            mapType="standard"
            class="flex-1"
            onRegionChange={(e) => console.log('region', e.detail.region)}
            onMarkerPress={(e) => console.log('marker', e.detail.id)}
        >
            <MapMarker
                coordinate={{ latitude: 59.3293, longitude: 18.0686 }}
                title="Stockholm"
                description="Sweden's capital"
                id="sthlm"
            />
        </Map>
    );
}
```

## API

### `<Map>`

| Prop | Type | Notes |
| --- | --- | --- |
| `region` | `MapRegion` | `{ latitude, longitude, latitudeDelta, longitudeDelta }`. The map snaps to this on every prop change — for "initial region only" semantics, pass it once and keep it in local state. |
| `showsUserLocation` | `boolean` | Shows the blue location dot. iOS uses `NSLocationWhenInUseUsageDescription` (added automatically); Android requires `ACCESS_FINE_LOCATION` at runtime (declared in the manifest). |
| `mapType` | `'standard' \| 'satellite' \| 'hybrid'` | Base style. Default `'standard'`. |
| `onRegionChange` | `(e) => void` | Fires after the user pans/zooms or after a programmatic `region` change. Detail: `{ region }`. |
| `onPress` | `(e) => void` | User tapped the map (not on a marker). Detail: `{ coordinate }`. |
| `onMarkerPress` | `(e) => void` | User tapped a marker. Detail: `{ id, coordinate }`. |
| `class`, `style`, `children` | — | Standard Lynx props. Children should be `<MapMarker>` elements. |

### `<MapMarker>`

| Prop | Type | Notes |
| --- | --- | --- |
| `coordinate` | `{ latitude, longitude }` | Required. |
| `title` | `string` | Callout title shown on tap. |
| `description` | `string` | Callout subtitle. |
| `id` | `string` | Forwarded as `event.detail.id` on the parent's `onMarkerPress`. |

### Android API key setup

Google Maps requires an API key. Get one at
[console.cloud.google.com](https://console.cloud.google.com/) → APIs &
Services → Credentials → "Maps SDK for Android".

Set it in `signalx.config.ts` under `android.googleMapsApiKey`. Prebuild
injects the required `com.google.android.geo.API_KEY` meta-data into the
generated `AndroidManifest.xml` for you — **don't hand-edit the manifest**, it's
a managed file that every `sigx prebuild` regenerates.

```ts
// signalx.config.ts
export default defineLynxConfig({
    // …
    android: {
        // Read from the environment so the key never lands in source control.
        // (signalx.config.ts is evaluated at prebuild time, so process.env works.)
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
    },
});
```

```bash
GOOGLE_MAPS_API_KEY=AIza… pnpm sigx prebuild   # or run:android / dev
```

If you don't set a key, prebuild injects a placeholder and prints a warning.
The app **still launches** — the map just renders blank and logs
`Authorization failure … API Key: …` at runtime (it does **not** crash). Set a
real key before shipping. On `sigx-lynx-go` (the prebuilt sandbox app) the blank
map is expected — we can't bundle a per-user API key in a public binary.

> Need a manifest `<meta-data>` key that isn't covered by a dedicated config
> field? Use the generic `android.manifestMetaData` map in `signalx.config.ts`.

## Web

Not supported. `<Map>` / `<MapMarker>` render the `<sigx-map>` / `<sigx-map-marker>` elements, which prebuild binds to `MKMapView` and Google Maps in the generated native registries; a web build registers only the sigx elements that ship a web implementation (`<sigx-richtext>`, `<sigx-touch-guard>`), and `@sigx/lynx-web-host` has no maps handler either — so in the browser these tags have nothing behind them. No browser API is missing: a web version would be a `<sigx-map>` custom element wrapping a JS map SDK (Google Maps JS API, MapLibre GL), and nobody has written one. Until then, branch on `__WEB__` / `Platform.OS` and render a fallback on web — e.g. a static map image plus an "open in Maps" link through [`@sigx/lynx-linking`](https://sigx.dev/lynx/modules/linking/overview/), whose `openURL` does work on web via the page bridge.

## Gotchas

- **`latitudeDelta` is honoured on iOS and ignored on Android.** iOS builds an `MKCoordinateSpan` from both deltas; Android derives a Google-Maps zoom level from `longitudeDelta` alone, because fitting both would need the view's pixel dimensions. A tall, narrow region therefore yields a noticeably different viewport per platform — size regions by longitude if you need them to match. And pass **all four** fields regardless: iOS drops a region missing either delta outright (logging `Ignoring malformed region prop`), where Android would still move. Tracked on [#890](https://github.com/signalxjs/lynx/issues/890).
- **`region` is not "initial region".** The map snaps to it on every prop change — hold it in local state and pass it once if you want the user's pan to stick.
- **`showsUserLocation` needs a runtime grant on Android.** `ACCESS_FINE_LOCATION` is declared in the manifest but must still be requested at runtime (`@sigx/lynx-location`'s `requestPermission()` does it); iOS only needs the usage description, which prebuild adds. Without the grant the dot silently never appears.
- **An Android build with no API key still launches.** Prebuild injects a placeholder and warns; the map renders blank and logs `Authorization failure … API Key: …`. That is also why the map is blank in `sigx-lynx-go` — a public binary can't ship a per-user key.

### Not in v1

Deliberately out of scope for the first version; none of these is refused, but none is implemented, and until an issue is linked here they are not tracked anywhere either:

- **Imperative methods** (`animateToRegion`, `fitToCoordinates`). Earlier versions of this README blamed a missing `UIMethodInvoker` surface — that is stale: `@sigx/lynx-webview`, `@sigx/lynx-list` and `@sigx/lynx-richtext` all drive native methods through `MainThread.Element.invoke` today. It is unimplemented, not blocked.
- **Custom marker icons** — markers use the platform default pin.
- **Polylines, polygons, circles, ground overlays.**
- **Clustering.**
- **Offline tiles / map snapshots.**
- **Google Maps on iOS** — iOS stays on MapKit (key-free); opting into the Google Maps SDK for iOS would be a separate backend.

### Lifecycle notes (Android)

`com.google.android.gms.maps.MapView` normally wants Activity lifecycle
forwarding (`onCreate`/`onResume`/`onPause`/`onDestroy`). v1 calls
`onCreate` + `onStart` + `onResume` in `createView`, and `onPause` +
`onStop` in `onDetach`. For a typical screen-level map this works; if the
host Activity is paused with the map still mounted, tile prefetching
keeps running until the LynxUI itself detaches. Proper `activityHook`
plumbing is unimplemented — like everything under "Not in v1", it has no
issue tracking it yet.

## License

MIT
