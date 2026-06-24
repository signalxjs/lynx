import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Avatar, Button, Card, Col, Heading, Row, Text } from '@sigx/lynx-daisyui';
import { List } from '@sigx/lynx-list';

interface FeedRow {
    id: number;
    title: string;
    subtitle: string;
}

const TOPICS = [
    'Dual-thread rendering',
    'Native list recycling',
    'Worklet gestures',
    'OTA updates',
    'SQLite live queries',
    'Spring motion',
    'Edge-to-edge layout',
    'Tree-shaken icons',
];

const PAGE = 200;

function makePage(start: number, n: number): FeedRow[] {
    const rows: FeedRow[] = [];
    for (let i = start; i < start + n; i++) {
        rows.push({
            id: i,
            title: `#${i} · ${TOPICS[i % TOPICS.length]}`,
            subtitle: 'Only the cells on screen exist as native views — scroll for miles.',
        });
    }
    return rows;
}

/**
 * List (`@sigx/lynx-list`) — a data-driven feed over the native `<list>`
 * recycler. The list below starts at 1,000 rows and grows by another page
 * each time you reach the bottom (`onEndReached`), yet only the handful of
 * visible cells are ever materialized as native views.
 *
 *  • `items` + `renderItem` + `keyExtractor` — the FlatList-style data API.
 *  • `header` / `footer` slots ride along as full-span cells.
 *  • `estimatedItemSize` keeps the scroll track accurate before cells measure.
 *  • Toggle 1 ↔ 2 columns to see `numColumns` (`span-count`) grid layout.
 */
export const ListDemo = component(() => {
    const rows = signal<{ value: FeedRow[] }>({ value: makePage(0, 1000) });
    const columns = signal(1);
    const loadingMore = signal(false);
    const refreshing = signal(false);

    const loadMore = (): void => {
        if (loadingMore.value || refreshing.value) return;
        loadingMore.value = true;
        // Simulate a network page so the loading footer is visible briefly.
        setTimeout(() => {
            rows.value = [...rows.value, ...makePage(rows.value.length, PAGE)];
            loadingMore.value = false;
        }, 600);
    };

    const onRefresh = (): void => {
        refreshing.value = true;
        // Simulate a refresh: rebuild the feed from the top.
        setTimeout(() => {
            rows.value = makePage(0, 1000);
            refreshing.value = false;
        }, 1000);
    };

    return () => (
        <view
            class="flex-fill bg-base-100"
            style={{ display: 'flex', flexDirection: 'column' }}
        >
            <Screen title="List" />
            <Row gap={8} padding={12} class="items-center">
                <Heading level={4} class="flex-1">{rows.value.length} rows</Heading>
                <Button
                    size="sm"
                    variant="outline"
                    onPress={() => { columns.value = columns.value === 1 ? 2 : 1; }}
                >
                    {columns.value === 1 ? '2 columns' : '1 column'}
                </Button>
            </Row>
            <view
                class="flex-1"
                style={{ display: 'flex', flexDirection: 'column', minHeight: '320px' }}
            >
                <List
                    items={rows.value}
                    keyExtractor={(r) => String(r.id)}
                    numColumns={columns.value}
                    listType={columns.value > 1 ? 'flow' : 'single'}
                    estimatedItemSize={88}
                    onEndReachedThreshold={8}
                    onEndReached={loadMore}
                    loadingMore={loadingMore.value}
                    refreshing={refreshing.value}
                    onRefresh={onRefresh}
                    style={{ flexGrow: 1 }}
                    renderItem={(r) => (
                        <view style={{ padding: '6px 12px' }}>
                            <Card bordered>
                                <Card.Body>
                                    <Row gap={12} class="items-center">
                                        <Avatar size="sm" placeholder={String(r.id % 100)} />
                                        <Col gap={2} class="flex-1">
                                            <Text weight="bold">{r.title}</Text>
                                            <Text size="sm" class="opacity-60">{r.subtitle}</Text>
                                        </Col>
                                    </Row>
                                </Card.Body>
                            </Card>
                        </view>
                    )}
                    slots={{
                        header: () => (
                            <Col padding={12} gap={4}>
                                <Heading level={3}>Virtualized feed</Heading>
                                <Text class="opacity-60">
                                    Pull down to refresh · scroll to the bottom to load more.
                                </Text>
                            </Col>
                        ),
                    }}
                />
            </view>
        </view>
    );
});
