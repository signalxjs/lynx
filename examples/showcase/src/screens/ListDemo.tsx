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

// A 10,000-item virtual source. `items` grows as you page in (load-on-demand,
// up to TOTAL), but only a bounded window of it is ever mounted as <list-item>
// cells (virtualization, capped at MAXWINDOW) — so the native / shadow-tree
// footprint stays bounded however far you scroll, even as the loaded array grows.
const TOTAL = 10_000;
const PAGE = 100;
const WINDOW = 40;
// Cap the mounted-cell count: with only windowSize set, maxWindow would default
// to max(120, windowSize*2), so pin it so the "cells mounted" label is honest.
const MAXWINDOW = WINDOW * 2;

function makeRange(start: number, n: number): FeedRow[] {
    const rows: FeedRow[] = [];
    const end = Math.min(start + n, TOTAL);
    for (let i = start; i < end; i++) {
        rows.push({
            id: i,
            title: `#${i} · ${TOPICS[i % TOPICS.length]}`,
            subtitle: 'Loaded on demand; only a windowed slice is mounted as native views.',
        });
    }
    return rows;
}

/**
 * List (`@sigx/lynx-list`) — 10,000-item stress test combining **virtualization**
 * and **load-on-demand**. The source has 10k rows but:
 *
 *  • **Load-on-demand** — `items` starts with one page and grows by another each
 *    time you reach the bottom (`onEndReached`), up to 10,000. The header shows
 *    how many are loaded so you can watch it stay far below the total.
 *  • **Virtualization** — `windowSize={40}` keeps only a bounded window of those
 *    loaded items mounted as `<list-item>`s, so the shadow tree never grows past
 *    ~`maxWindow` cells however far you scroll.
 *  • Pull-to-refresh resets to the first page; 1 ↔ 2 columns toggles the grid.
 */
export const ListDemo = component(() => {
    const rows = signal<{ value: FeedRow[] }>({ value: makeRange(0, PAGE) });
    const columns = signal(1);
    const loadingMore = signal(false);
    const refreshing = signal(false);

    // Bumped whenever a refresh resets the feed, so an in-flight load-more append
    // that resolves after the reset is discarded instead of racing it back past
    // the first page.
    let epoch = 0;

    const loadMore = (): void => {
        if (loadingMore.value || refreshing.value) return;
        if (rows.value.length >= TOTAL) return;
        loadingMore.value = true;
        const myEpoch = epoch;
        // Simulate a network/db page so the loading footer is visible briefly.
        setTimeout(() => {
            if (epoch === myEpoch) {
                rows.value = [...rows.value, ...makeRange(rows.value.length, PAGE)];
            }
            loadingMore.value = false;
        }, 400);
    };

    const onRefresh = (): void => {
        refreshing.value = true;
        epoch++; // invalidate any in-flight load-more
        setTimeout(() => {
            rows.value = makeRange(0, PAGE);
            refreshing.value = false;
        }, 800);
    };

    return () => {
        const loaded = rows.value.length;
        return (
            <view
                class="flex-fill bg-base-100"
                style={{ display: 'flex', flexDirection: 'column' }}
            >
                <Screen title="List · 10k stress" />
                <Row gap={8} padding={12} class="items-center">
                    <Col gap={2} class="flex-1">
                        <Heading level={4}>{loaded.toLocaleString()} / {TOTAL.toLocaleString()} loaded</Heading>
                        <Text size="sm" class="opacity-60">
                            windowed — ≤{MAXWINDOW} cells mounted
                        </Text>
                    </Col>
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
                        windowSize={WINDOW}
                        maxWindow={MAXWINDOW}
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
                                    <Heading level={3}>10,000-item virtualized feed</Heading>
                                    <Text class="opacity-60">
                                        Pull to refresh · scroll down to page in more (load-on-demand).
                                    </Text>
                                </Col>
                            ),
                        }}
                    />
                </view>
            </view>
        );
    };
});
