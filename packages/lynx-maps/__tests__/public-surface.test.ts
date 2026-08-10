/**
 * Public-surface freeze test for @sigx/lynx-maps.
 *
 * Locks the package's exported API so an accidental removal or rename breaks
 * CI rather than reaching consumers. When the surface changes intentionally,
 * update both the value snapshot and the type assertions here in the same PR.
 *
 * Modelled on `packages/lynx-clipboard/__tests__/public-surface.test.ts`.
 * Two layers:
 *  - Runtime: the set of *value* exports is exactly what we expect. This
 *    package is component-only — every other export (`MapProps`, `MapRegion`,
 *    the event types, the JSX attribute interfaces) is type-only and erased at
 *    runtime, so it is pinned below instead.
 *  - Types: the load-bearing shapes. There is no native module namespace here,
 *    so `CONVENTIONS.md`'s `isAvailable` (C2), permission (C6) and
 *    subscription (C7) contracts don't apply; the weight goes on the prop and
 *    event shapes, which are what a consumer's `<Map>` call site is written
 *    against and what the native iOS/Android setters parse.
 *
 * Note: this package has no `.web.ts` sibling — `<sigx-map>` is a native-only
 * element — so there is no web-parity block (D7.1b) to assert.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';

import * as maps from '../src/index';
import type {
    MapCoordinate,
    MapMarkerPressEvent,
    MapMarkerProps,
    MapPressEvent,
    MapProps,
    MapRegion,
    MapRegionChangeEvent,
    MapType,
    SigxMapAttributes,
    SigxMapMarkerAttributes,
} from '../src/index';

describe('public runtime exports', () => {
    it('matches the locked surface', () => {
        expect(Object.keys(maps).sort()).toEqual(['Map', 'MapMarker'].sort());
    });
});

describe('public types', () => {
    it('pins the <Map> prop surface', () => {
        // Every one of these is optional by design: a `<Map>` with no props
        // renders the platform default region. Making `region` required would
        // be a breaking change that a runtime snapshot can never catch.
        expectTypeOf<MapProps['region']>().toEqualTypeOf<MapRegion | undefined>();
        expectTypeOf<MapProps['mapType']>().toEqualTypeOf<MapType | undefined>();
        expectTypeOf<MapProps['showsUserLocation']>().toEqualTypeOf<boolean | undefined>();
        expectTypeOf<MapType>().toEqualTypeOf<'standard' | 'satellite' | 'hybrid'>();
    });

    it('pins the region struct the native side parses', () => {
        // `region` crosses the wire as JSON and is decoded field-by-field by
        // MKMapView / GoogleMap; renaming or dropping a delta silently yields a
        // whole-world viewport rather than a type error on the native side.
        expectTypeOf<MapRegion>().toEqualTypeOf<{
            latitude: number;
            longitude: number;
            latitudeDelta: number;
            longitudeDelta: number;
        }>();
        expectTypeOf<MapCoordinate>().toEqualTypeOf<{ latitude: number; longitude: number }>();
    });

    it('keeps MapMarker.coordinate required', () => {
        // A marker without a coordinate has nowhere to render, so the JS
        // wrapper emits `coordinate` unconditionally (#475). If the prop drifted
        // to optional, `JSON.stringify(undefined)` reaches the native
        // `NSString *` setter as NSNull and crashes it.
        expectTypeOf<MapMarkerProps['coordinate']>().toEqualTypeOf<MapCoordinate>();
        expectTypeOf<Record<string, never> extends Pick<MapMarkerProps, 'coordinate'> ? true : false>()
            .toEqualTypeOf<false>();
        expectTypeOf<MapMarkerProps['title']>().toEqualTypeOf<string | undefined>();
        expectTypeOf<MapMarkerProps['id']>().toEqualTypeOf<string | undefined>();
    });

    it('pins the event handlers and their discriminants', () => {
        // Handlers are written inline at the call site against `e.detail`, so
        // the detail shape *is* the public API. The `type` literals stay
        // narrowed so a union of map events can still be discriminated.
        expectTypeOf<MapProps['onRegionChange']>().toEqualTypeOf<
            ((e: MapRegionChangeEvent) => void) | undefined
        >();
        expectTypeOf<MapProps['onPress']>().toEqualTypeOf<((e: MapPressEvent) => void) | undefined>();
        expectTypeOf<MapProps['onMarkerPress']>().toEqualTypeOf<
            ((e: MapMarkerPressEvent) => void) | undefined
        >();
        expectTypeOf<MapRegionChangeEvent['type']>().toEqualTypeOf<'regionchange'>();
        expectTypeOf<MapPressEvent['type']>().toEqualTypeOf<'press'>();
        expectTypeOf<MapMarkerPressEvent['type']>().toEqualTypeOf<'markerpress'>();
        expectTypeOf<MapRegionChangeEvent['detail']['region']>().toEqualTypeOf<MapRegion>();
        expectTypeOf<MapMarkerPressEvent['detail']['id']>().toEqualTypeOf<string>();
    });

    it('pins the wire-level JSX attributes as JSON strings', () => {
        // Lynx props carry no object types, so `region` / `coordinate` are
        // JSON-on-the-wire. Widening either to an object here would typecheck
        // in JS and arrive at the native parser as "[object Object]".
        expectTypeOf<SigxMapAttributes['region']>().toEqualTypeOf<string | undefined>();
        expectTypeOf<SigxMapAttributes['map-type']>().toEqualTypeOf<MapType | undefined>();
        expectTypeOf<SigxMapMarkerAttributes['coordinate']>().toEqualTypeOf<string>();
        expectTypeOf<SigxMapMarkerAttributes['marker-id']>().toEqualTypeOf<string | undefined>();
    });
});
