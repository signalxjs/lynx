import { component, onUnmounted, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Alert, Button, Card, Col, Heading, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { Memory, type MemoryUsageSnapshot } from '@sigx/lynx-observability';
import { Haptics } from '@sigx/lynx-haptics';

/**
 * Lynx engine memory usage — `LynxMemoryUsageQuery` on both platforms, and
 * deliberately unsupported on web.
 *
 * Exercises the failure paths as well as the happy one (rubric D7.7): the
 * unlinked-module throw, the web rejection, and — the interesting one — a
 * `timeoutMs: 1` query, which returns a *partial* result rather than an error.
 * That partial case is the one most likely to be misread as a memory drop, so
 * the demo shows it explicitly.
 */

const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

export const ObservabilityDemo = component(() => {
    // Wrapped in `{ value }` because `signal<T>` needs an object to proxy — the
    // same shape FilePickerDemo uses for its nullable result.
    const snapshot = signal<{ value: MemoryUsageSnapshot | null }>({ value: null });
    const error = signal<string | null>(null);
    const busy = signal(false);
    const readings = signal(0);
    // The disposer is an identity the render must not read; this flag is the
    // state it should, so the button label re-renders.
    const reportingOn = signal(false);

    const available = Memory.isAvailable();

    let stopReporting: (() => void) | undefined;

    const toggleReporting = () => {
        Haptics.selection();
        if (stopReporting) {
            stopReporting();
            stopReporting = undefined;
            reportingOn.value = false;
            return;
        }
        readings.value = 0;
        reportingOn.value = true;
        // 5s rather than the 60s default so the demo shows something before you
        // lose interest. Each reading also goes to the logger, so they stream
        // into the `sigx dev` terminal under `memory`.
        stopReporting = Memory.startReporting({
            intervalMs: 5000,
            onReading: () => { readings.value += 1; },
        });
    };

    // Leaving the screen with a timer still armed is the leak this package
    // exists to notice.
    onUnmounted(() => stopReporting?.());

    const query = (timeoutMs?: number) => async () => {
        Haptics.selection();
        error.value = null;
        busy.value = true;
        try {
            snapshot.value = await Memory.query(timeoutMs === undefined ? {} : { timeoutMs });
        } catch (e) {
            // The throw when the module isn't linked, and the rejection on web,
            // both land here — that *is* the failure path under test.
            snapshot.value = null;
            error.value = e instanceof Error ? e.message : String(e);
        } finally {
            busy.value = false;
        }
    };

    return () => {
        const m = snapshot.value;
        const partial = m !== null && m.completedInstanceCount < m.expectedInstanceCount;
        return (
            <ScrollView class="flex-fill bg-base-100">
                <Screen title="Memory" />
                <Col gap={16} padding={16}>
                    <Heading level={2}>Engine memory</Heading>

                    {!available && (
                        <Alert color="warning">
                            Native module not linked — the query below will throw. Run
                            `sigx prebuild` and rebuild. On web this is expected: there is
                            no Lynx engine to attribute memory to.
                        </Alert>
                    )}

                    {error.value !== null && (
                        <Alert color="error">
                            <Text class="font-mono text-xs">{error.value}</Text>
                        </Alert>
                    )}

                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Text weight="semibold">Query</Text>
                                <Text class="opacity-60 text-sm">
                                    One process-global reading covering every LynxView.
                                    Available: {String(available)}.
                                </Text>
                                <Row gap={8}>
                                    <Button color="primary" disabled={busy.value} onPress={query()}>
                                        Query memory
                                    </Button>
                                    <Button
                                        variant="outline"
                                        disabled={busy.value}
                                        onPress={query(1)}
                                    >
                                        Force a timeout
                                    </Button>
                                </Row>
                                <Text class="opacity-60 text-sm">
                                    "Force a timeout" passes `timeoutMs: 1`. It should
                                    resolve, not reject — with `collectionStatus: 'timeout'`
                                    and a partial instance count.
                                </Text>
                            </Col>
                        </Card.Body>
                    </Card>

                    <Card bordered>
                        <Card.Body>
                            <Col gap={8}>
                                <Text weight="semibold">Sample on a timer</Text>
                                <Text class="opacity-60 text-sm">
                                    `Memory.startReporting()` logs each reading under the
                                    `memory` namespace, so they also stream into the `sigx
                                    dev` terminal and any configured sink.
                                </Text>
                                <Row gap={8}>
                                    <Button variant="outline" onPress={toggleReporting}>
                                        {reportingOn.value ? 'Stop reporting' : 'Report every 5s'}
                                    </Button>
                                </Row>
                                <Text class="font-mono text-sm opacity-70">
                                    {`readings ${readings.value}`}
                                </Text>
                            </Col>
                        </Card.Body>
                    </Card>

                    {m !== null && (
                        <Card bordered>
                            <Card.Body>
                                <Col gap={8}>
                                    <Text weight="semibold">Totals</Text>
                                    {partial && (
                                        <Alert color="warning">
                                            {/* One interpolation, not several: Alert lays its
                                                children out in a row, so each adjacent text node
                                                becomes its own box and the numbers get stranded
                                                mid-sentence. */}
                                            <Text>
                                                {`Partial result — ${m.completedInstanceCount} of `
                                                    + `${m.expectedInstanceCount} instances reported. `
                                                    + `Every figure below is a partial sum; don't `
                                                    + `diff it against a complete reading.`}
                                            </Text>
                                        </Alert>
                                    )}
                                    <Text class="font-mono text-sm opacity-70">
                                        status {m.collectionStatus} · took{' '}
                                        {m.collectionDurationMs}ms of {m.collectionTimeoutMs}ms ·{' '}
                                        {m.completedInstanceCount}/{m.expectedInstanceCount}{' '}
                                        instance(s)
                                    </Text>
                                    <Text class="font-mono text-sm opacity-70">
                                        lynx {mb(m.totalBytes)} of app {mb(m.appBytes)} ·{' '}
                                        {(m.ratioToApp * 100).toFixed(1)}%
                                    </Text>
                                    <Text class="font-mono text-sm opacity-70">
                                        elements {mb(m.elementBytes)} over {m.elementNodeCount}{' '}
                                        node(s) · views {mb(m.viewBytes)}
                                    </Text>
                                    <Text class="font-mono text-sm opacity-70">
                                        runtime MT {mb(m.mainThreadRuntimeBytes)} · BG{' '}
                                        {mb(m.backgroundThreadRuntimeBytes)}
                                    </Text>
                                </Col>
                            </Card.Body>
                        </Card>
                    )}

                    {m !== null && (
                        <Card bordered>
                            <Card.Body>
                                <Col gap={8}>
                                    <Text weight="semibold">
                                        Instances ({m.instances.length})
                                    </Text>
                                    {m.instances.length === 0 && (
                                        <Text class="opacity-60 text-sm">
                                            None reported. Under a forced timeout that is the
                                            expected outcome, not a bug.
                                        </Text>
                                    )}
                                    {m.instances.map((i) => (
                                        <Col key={`${String(i.instanceId)}-${i.pageId}`} gap={2}>
                                            <Text class="font-mono text-xs opacity-70">
                                                #{i.instanceId === null ? 'unattached' : i.instanceId}{' '}
                                                {i.url || '(no url)'}
                                            </Text>
                                            <Text class="font-mono text-xs opacity-50">
                                                {mb(i.totalBytes)} · elements {mb(i.elementBytes)}/
                                                {i.elementNodeCount} nodes · views{' '}
                                                {mb(i.viewBytes)} · runtime {mb(i.mainThreadRuntimeBytes)}
                                                /{mb(i.backgroundThreadRuntimeBytes)}
                                            </Text>
                                        </Col>
                                    ))}
                                </Col>
                            </Card.Body>
                        </Card>
                    )}

                    <Card bordered>
                        <Card.Body>
                            <Col gap={4}>
                                <Text weight="semibold">Reading the numbers</Text>
                                <Text class="opacity-60 text-sm">
                                    `elementBytes` against `elementNodeCount` is the pairing
                                    worth watching — it turns "the screen went blank" into
                                    "we're mounting 12,000 nodes". Open the 10k list stress
                                    screen, come back, and query again.
                                </Text>
                                <Text class="opacity-60 text-sm">
                                    Instances sharing a background runtime have their bytes
                                    counted once in the total, so the per-instance figures can
                                    sum to more than `totalBytes`. That is by design.
                                </Text>
                            </Col>
                        </Card.Body>
                    </Card>
                </Col>
            </ScrollView>
        );
    };
});
