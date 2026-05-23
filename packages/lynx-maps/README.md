# @sigx/lynx-maps

Native map view for sigx-lynx. Backed by:

- **iOS** — `MKMapView` (Apple Maps, no key required).
- **Android** — `com.google.android.gms.maps.MapView` (Google Maps,
  requires an API key — see [setup](#android-api-key-setup) below).

Closes [signalxjs/lynx#84](https://github.com/signalxjs/lynx/issues/84).

## Install

```bash
pnpm add @sigx/lynx-maps
pnpm sigx prebuild
```

The autolinker picks up `signalx-module.json` from this package; prebuild
regenerates `GeneratedBehaviors.kt` (Android) and
`GeneratedComponentRegistry.swift` (iOS) so the `<sigx-map>` and
`<sigx-map-marker>` tags are bound to their native UI classes.

## Quick start

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

## Props — `<Map>`

| Prop | Type | Notes |
| --- | --- | --- |
| `region` | `MapRegion` | `{ latitude, longitude, latitudeDelta, longitudeDelta }`. The map snaps to this on every prop change — for "initial region only" semantics, pass it once and keep it in local state. |
| `showsUserLocation` | `boolean` | Shows the blue location dot. iOS uses `NSLocationWhenInUseUsageDescription` (added automatically); Android requires `ACCESS_FINE_LOCATION` at runtime (declared in the manifest). |
| `mapType` | `'standard' \| 'satellite' \| 'hybrid'` | Base style. Default `'standard'`. |
| `onRegionChange` | `(e) => void` | Fires after the user pans/zooms or after a programmatic `region` change. Detail: `{ region }`. |
| `onPress` | `(e) => void` | User tapped the map (not on a marker). Detail: `{ coordinate }`. |
| `onMarkerPress` | `(e) => void` | User tapped a marker. Detail: `{ id, coordinate }`. |
| `class`, `style`, `children` | — | Standard Lynx props. Children should be `<MapMarker>` elements. |

## Props — `<MapMarker>`

| Prop | Type | Notes |
| --- | --- | --- |
| `coordinate` | `{ latitude, longitude }` | Required. |
| `title` | `string` | Callout title shown on tap. |
| `description` | `string` | Callout subtitle. |
| `id` | `string` | Forwarded as `event.detail.id` on the parent's `onMarkerPress`. |

## Android API key setup

Google Maps requires an API key. Get one at
[console.cloud.google.com](https://console.cloud.google.com/) → APIs &
Services → Credentials → "Maps SDK for Android".

Once you have a key, add the standard meta-data block inside
`<application>` in `android/app/src/main/AndroidManifest.xml`:

```xml
<meta-data
    android:name="com.google.android.geo.API_KEY"
    android:value="@string/google_maps_api_key" />
```

…and define the string in `android/app/src/main/res/values/strings.xml`:

```xml
<resources>
    <!-- existing entries -->
    <string name="google_maps_api_key" translatable="false">YOUR_KEY_HERE</string>
</resources>
```

If you don't add the meta-data block, the map still renders — but with
Google's "For development purposes only" watermark. That's fine for early
testing; ship a real key before publishing to the Play Store.

On `sigx-lynx-go` (the prebuilt sandbox app) the placeholder watermark is
expected — we can't bundle a per-user API key in a public binary.

## Limitations (v1)

Tracked as v2 follow-ups:

- **Imperative methods** (`animateToRegion`, `fitToCoordinates`) need
  Lynx's `UIMethodInvoker` surface, which isn't wired through sigx-lynx
  yet. Same blocker as `WebView.goBack` / `reload`.
- **Custom marker icons** — markers use the platform default pin.
- **Polylines, polygons, circles, ground overlays.**
- **Clustering.**
- **Offline tiles / Map snapshots.**
- **Google Maps on iOS** — iOS stays on MapKit (key-free); a future
  follow-up could let apps opt into the Google Maps SDK for iOS.

## Lifecycle notes (Android)

`com.google.android.gms.maps.MapView` normally wants Activity lifecycle
forwarding (`onCreate`/`onResume`/`onPause`/`onDestroy`). v1 calls
`onCreate` + `onStart` + `onResume` in `createView`, and `onPause` +
`onStop` in `onDetach`. For a typical screen-level map this works; if the
host Activity is paused with the map still mounted, tile prefetching
keeps running until the LynxUI itself detaches. A proper `activityHook`
plumbing is tracked as a follow-up.

## License

MIT
