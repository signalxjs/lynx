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
    const loading = signal(false);

    const loadMore = (): void => {
        if (loading.value) return;
        loading.value = true;
        const next = makePage(rows.value.length, PAGE);
        rows.value = [...rows.value, ...next];
        loading.value = false;
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
                                    Scroll to the bottom to auto-load the next page.
                                </Text>
                            </Col>
                        ),
                        footer: () => (
                            <Col padding={16} class="items-center">
                                <Text class="opacity-60">Loading more…</Text>
                            </Col>
                        ),
                    }}
                />
            </view>
        </view>
    );
});
