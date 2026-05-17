import { component } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Badge,
    Card,
    Center,
    Col,
    Heading,
    ScrollView,
    Text,
} from '@sigx/lynx-daisyui';
import { trips } from '../store/trips.js';

interface GeotaggedRow {
    tripName: string;
    note: string;
    lat: number;
    lng: number;
    createdAt: number;
}

/**
 * Flatten every trip's geotagged entries into a single list, sorted newest
 * first. No real map view yet — the plan calls for grouping by coords; for
 * now a flat list keyed by coords is enough to demonstrate the location
 * module is wired and the data lands on the entry.
 *
 * Uses `.flatMap` + `.filter` rather than `for…of` because the @sigx
 * reactivity proxy's `Symbol.iterator` behaviour is inconsistent — array
 * methods (`.map` / `.flatMap` / `.filter`) reliably track reads.
 */
function getGeotaggedEntries(): GeotaggedRow[] {
    return trips
        .flatMap((trip) =>
            trip.entries
                .filter((e): e is typeof e & { coords: NonNullable<typeof e.coords> } => e.coords != null)
                .map((e) => ({
                    tripName: trip.name,
                    note: e.note,
                    lat: e.coords.lat,
                    lng: e.coords.lng,
                    createdAt: e.createdAt,
                })),
        )
        .sort((a, b) => b.createdAt - a.createdAt);
}

export const Map = component(() => {
    return () => {
        // Touch the proxy here so the screen re-renders when new
        // geotagged entries are added.
        const rows = getGeotaggedEntries();

        if (rows.length === 0) {
            return (
                <Center flex={1} class="bg-base-100 p-6">
                    <Screen headerShown={false} />
                    <Col gap={8} align="center">
                        <Heading level={2}>Map</Heading>
                        <Text class="opacity-60">No geotagged entries yet</Text>
                        <Text class="opacity-60 text-sm">
                            Add an entry to a trip — its GPS coords show up here.
                        </Text>
                    </Col>
                </Center>
            );
        }

        return (
            <view class="flex-fill bg-base-100">
                <Screen headerShown={false} />
                <ScrollView class="flex-1">
                    <Col gap={12} padding={16}>
                        <Heading level={2}>Map</Heading>
                        <Text class="opacity-60">
                            {rows.length} geotagged {rows.length === 1 ? 'entry' : 'entries'}
                        </Text>
                        {rows.map((r) => (
                            <Card bordered>
                                <Card.Body>
                                    <Text weight="semibold">{r.tripName}</Text>
                                    <Text>{r.note}</Text>
                                    <Badge variant="ghost" size="sm" class="self-start mt-2">
                                        {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                                    </Badge>
                                </Card.Body>
                            </Card>
                        ))}
                    </Col>
                </ScrollView>
            </view>
        );
    };
});
