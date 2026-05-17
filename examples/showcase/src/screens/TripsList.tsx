import { component } from '@sigx/lynx';
import { useNav, useScreenOptions, Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, ScrollView, Text } from '@sigx/lynx-daisyui';
import { trips } from '../store/trips.js';

export const TripsList = component(() => {
    const nav = useNav();
    useScreenOptions({ title: 'Trips' });

    return () => (
        <view class="flex-fill">
            <Screen>
                <Screen.HeaderRight>
                    <view
                        bindtap={() => nav.push('newTrip')}
                        class="px-3 py-2"
                        accessibility-element={true}
                        accessibility-label="New trip"
                        accessibility-trait="button"
                    >
                        <text class="text-primary text-base font-semibold">+</text>
                    </view>
                </Screen.HeaderRight>
            </Screen>

            <ScrollView class="flex-1">
                <Col gap={12} padding={16}>
                    {trips.length === 0
                        ? <Text class="opacity-60">No trips yet — tap + to add one</Text>
                        : trips.map((trip) => (
                            <view
                                bindtap={() => nav.push('tripDetail', { tripId: trip.id })}
                                accessibility-element={true}
                                accessibility-label={`Open trip ${trip.name}`}
                                accessibility-trait="button"
                            >
                                <Card bordered>
                                    <Card.Body>
                                        <Card.Title>{trip.name}</Card.Title>
                                        <Text class="opacity-60">
                                            {trip.entries.length} {trip.entries.length === 1 ? 'entry' : 'entries'}
                                        </Text>
                                    </Card.Body>
                                </Card>
                            </view>
                        ))}
                    <Button variant="primary" onPress={() => nav.push('newTrip')}>
                        New trip
                    </Button>
                </Col>
            </ScrollView>
        </view>
    );
});
