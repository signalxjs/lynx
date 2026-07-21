import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';

/**
 * Dynamic import — code-splitting via `import()`. The payload module lands in
 * a separate async chunk (`dist/static/js/async/<hash>.js`) that the runtime
 * fetches on first use: from the dev server in `sigx dev`, from embedded
 * assets in standalone/release builds (#599). If chunk loading is broken the
 * button surfaces the loader error instead of failing silently.
 */
export const DynamicImportDemo = component(() => {
    const result = signal<string | null>(null);
    const error = signal<string | null>(null);
    const loading = signal(false);

    const load = async () => {
        loading.value = true;
        error.value = null;
        try {
            const mod = await import('./dynamic-payload.js');
            result.value = mod.describePayload();
        } catch (err) {
            error.value = err instanceof Error ? err.message : String(err);
        } finally {
            loading.value = false;
        }
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Dynamic import" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Dynamic import</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Load an async chunk</Text>
                            <Text class="opacity-60 text-sm">
                                The payload module is split into its own chunk and
                                loaded on demand — works in dev and in store builds.
                            </Text>
                            <Button
                                color="primary"
                                loading={loading.value}
                                onPress={load}
                            >
                                {result.value ? 'Load again' : 'Load payload'}
                            </Button>
                            <Text class={error.value ? 'text-error text-sm' : result.value ? 'text-success' : 'opacity-40 text-sm'}>
                                {error.value ?? result.value ?? 'Not loaded yet'}
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
