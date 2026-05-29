import { component } from '@sigx/lynx';
import { useDrawer, useNav, useScreenOptions, Screen } from '@sigx/lynx-navigation';
import { Button, Card, Text } from '@sigx/lynx-daisyui';
import { LucideIcon } from '@sigx/lynx-icons-lucide/components';
import { trips } from '../store/trips.js';

export const TripsList = component(() => {
    const nav = useNav();
    const drawer = useDrawer();
    useScreenOptions({ title: 'Trips' });

    return () => (
        <view class="flex-fill bg-base-100">
            <Screen>
                <Screen.HeaderLeft>
                    <view
                        bindtap={() => drawer.toggle()}
                        class="px-3 py-2"
                        accessibility-element={true}
                        accessibility-label="Open menu"
                        accessibility-trait="button"
                    >
                        {/* `variant="primary"` is resolved by daisy's
                            ThemeProvider to the primary hex and substituted
                            into the icon's SVG `fill=` attribute — Lynx's
                            parsed SVG content doesn't inherit host CSS, so
                            class-based theming doesn't reach the fill. */}
                        <LucideIcon name="menu" size={22} variant="primary" />
                    </view>
                </Screen.HeaderLeft>
                <Screen.HeaderRight>
                    <view
                        bindtap={() => nav.push('newTrip')}
                        class="px-3 py-2"
                        accessibility-element={true}
                        accessibility-label="New trip"
                        accessibility-trait="button"
                    >
                        <LucideIcon name="plus" size={22} variant="primary" />
                    </view>
                </Screen.HeaderRight>
            </Screen>

            {/* Native recycler list (`<list>`/`<list-item>`) — only visible
                rows mount. `<list>` accepts only `<list-item>` children, so the
                empty-state and the trailing "New trip" button are each wrapped
                in their own item. */}
            <list
                class="flex-1"
                list-type="single"
                span-count={1}
                scroll-orientation="vertical"
            >
                {trips.length === 0
                    ? (
                        <list-item key="empty" item-key="empty">
                            <view class="px-4 py-3">
                                <Text class="opacity-60">No trips yet — tap + to add one</Text>
                            </view>
                        </list-item>
                    )
                    : trips.map((trip) => (
                        <list-item key={trip.id} item-key={trip.id}>
                            <view
                                class="px-4 py-2"
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
                        </list-item>
                    ))}
                <list-item key="new-trip" item-key="new-trip">
                    <view class="px-4 py-3">
                        <Button variant="primary" onPress={() => nav.push('newTrip')}>
                            New trip
                        </Button>
                    </view>
                </list-item>
            </list>
        </view>
    );
});
