import { component } from '@sigx/lynx';
import { useNav, useParams, Screen } from '@sigx/lynx-navigation';
import { Badge, Button, Card, Col, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { Share } from '@sigx/lynx-share';
import { deleteEntry, getTrip, trips } from '../store/trips.js';
import type { Trip } from '../store/types.js';

/** Old store entries (from before the picker added the file:// scheme)
 * may have a bare absolute path as `photoUri`. Lynx's `<image>` needs a
 * scheme to load it; prepend `file://` for any raw path so persisted
 * data keeps rendering after the framework fix.*/
function normalizePhotoUri(uri: string): string {
    return uri.startsWith('/') ? `file://${uri}` : uri;
}

function buildSummary(trip: Trip): string {
    if (trip.entries.length === 0) return `${trip.name}\n(no entries yet)`;
    const lines = trip.entries.map((e) => {
        const date = new Date(e.createdAt).toLocaleDateString();
        const where = e.coords ? ` @ ${e.coords.lat.toFixed(3)},${e.coords.lng.toFixed(3)}` : '';
        return `• ${date}${where} — ${e.note}`;
    });
    return `${trip.name}\n\n${lines.join('\n')}`;
}

export const TripDetail = component(() => {
    const nav = useNav();
    const { tripId } = useParams('tripDetail');

    return () => {
        // Reading from the trips proxy makes the screen reactive to entry adds.
        const trip = trips.find((t) => t.id === tripId);

        if (!trip) {
            return (
                <view class="flex-fill bg-base-100 p-6">
                    <Text class="opacity-60">Trip not found</Text>
                </view>
            );
        }

        const share = () => {
            Haptics.selection();
            Share.share({ title: trip.name, message: buildSummary(trip) });
        };

        const remove = (entryId: string) => {
            Haptics.notification('warning');
            deleteEntry(tripId, entryId);
        };

        return (
            <view class="flex-fill">
                <Screen title={() => getTrip(tripId)?.name ?? 'Trip'}>
                    <Screen.HeaderRight>
                        <Row gap={4} align="center">
                            <view bindtap={share} class="px-3 py-2">
                                <text class="text-primary text-base">Share</text>
                            </view>
                            <view bindtap={() => nav.push('newEntry', { tripId })} class="px-3 py-2">
                                <text class="text-primary text-xl font-semibold">+</text>
                            </view>
                        </Row>
                    </Screen.HeaderRight>
                </Screen>

                <ScrollView class="flex-1">
                    <Col gap={12} padding={16}>
                        {trip.entries.length === 0
                            ? <Text class="opacity-60">No entries yet — tap + to add one</Text>
                            : trip.entries.map((e) => (
                                <Card bordered>
                                    <Card.Body>
                                        {e.photoUri
                                            ? <image
                                                src={normalizePhotoUri(e.photoUri)}
                                                mode="aspectFill"
                                                style={{ width: '100%', height: 180, borderRadius: 10, marginBottom: 8 }}
                                            />
                                            : null}
                                        <Text>{e.note}</Text>
                                        <Row gap={8} align="center" class="mt-2">
                                            {e.coords
                                                ? <Badge variant="ghost" size="sm">
                                                    {e.coords.lat.toFixed(3)}, {e.coords.lng.toFixed(3)}
                                                </Badge>
                                                : null}
                                            <view style={{ flexGrow: 1 }} />
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                onPress={() => nav.push('newEntry', { tripId, entryId: e.id })}
                                            >
                                                Edit
                                            </Button>
                                            <Button size="xs" variant="ghost" onPress={() => remove(e.id)}>
                                                Delete
                                            </Button>
                                        </Row>
                                    </Card.Body>
                                </Card>
                            ))}
                    </Col>
                </ScrollView>
            </view>
        );
    };
});
