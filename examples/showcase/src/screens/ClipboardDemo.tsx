import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Alert, Button, Card, Col, Heading, Input, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { Clipboard } from '@sigx/lynx-clipboard';
import { Haptics } from '@sigx/lynx-haptics';

/**
 * Clipboard — `UIPasteboard` on iOS, `ClipboardManager` on Android, and
 * `navigator.clipboard` through the host bridge on web.
 *
 * Deliberately exercises the failure paths as well as the happy one (rubric
 * D7.7): the unlinked-module throw, an empty clipboard, and — on web — a
 * denied read. Those are the states a demo usually hides and a user actually
 * hits.
 */
export const ClipboardDemo = component(() => {
    const draft = signal('Copied from the sigx showcase');
    const pasted = signal<string | null>(null);
    const hasText = signal<boolean | null>(null);
    const error = signal<string | null>(null);

    const available = Clipboard.isAvailable();

    /**
     * Every method throws when the module isn't linked (C3), so the demo shows
     * the error rather than dying — that *is* the failure path under test.
     */
    const run = (fn: () => void | Promise<void>) => async () => {
        Haptics.selection();
        error.value = null;
        try {
            await fn();
        } catch (e) {
            error.value = e instanceof Error ? e.message : String(e);
        }
    };

    const onCopy = run(() => {
        Clipboard.setString(draft.value);
        // setString is sync void — there is nothing to await and no way to
        // learn whether it worked. Read back so the demo shows something real.
        pasted.value = null;
    });

    const onPaste = run(async () => {
        pasted.value = await Clipboard.getString();
    });

    const onCheck = run(async () => {
        hasText.value = await Clipboard.hasString();
    });

    const onClear = run(() => {
        // Writing '' is how you clear it; both native sides coalesce null to ''.
        Clipboard.setString('');
        pasted.value = null;
        hasText.value = null;
    });

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Clipboard" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Clipboard</Heading>

                {!available && (
                    <Alert color="warning">
                        Native module not linked — every call below will throw. Run
                        `sigx prebuild` and rebuild.
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
                            <Text weight="semibold">Copy</Text>
                            <Text class="opacity-60 text-sm">
                                `setString` is synchronous and returns nothing, so a
                                failed write is invisible — paste back to confirm it
                                landed. Available: {String(available)}.
                            </Text>
                            <Input
                                placeholder="Text to copy"
                                variant="bordered"
                                model={() => draft.value}
                            />
                            <Row gap={8}>
                                <Button color="primary" onPress={onCopy}>
                                    Copy
                                </Button>
                                <Button variant="ghost" onPress={onClear}>
                                    Clear
                                </Button>
                            </Row>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Paste</Text>
                            <Text class="opacity-60 text-sm">
                                On iOS 14+ this shows a system "Pasted from …" toast, so
                                it runs on a tap and never on a poll. An empty clipboard
                                resolves to an empty string, not an error.
                            </Text>
                            <Row gap={8}>
                                <Button color="secondary" onPress={onPaste}>
                                    Paste
                                </Button>
                                <Button variant="outline" onPress={onCheck}>
                                    Has text?
                                </Button>
                            </Row>
                            <Text class="font-mono text-sm opacity-70">
                                {pasted.value === null
                                    ? 'getString() — not read yet'
                                    : pasted.value === ''
                                      ? 'getString() → "" (clipboard is empty)'
                                      : `getString() → ${JSON.stringify(pasted.value)}`}
                            </Text>
                            <Text class="font-mono text-sm opacity-70">
                                {hasText.value === null
                                    ? 'hasString() — not checked yet'
                                    : `hasString() → ${String(hasText.value)}`}
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">On web</Text>
                            <Text class="opacity-60 text-sm">
                                The same API routes through the `@sigx/lynx-web-host`
                                page bridge to `navigator.clipboard` — the app worker has
                                no clipboard access of its own. A read may prompt for
                                permission; denying it resolves to an empty string rather
                                than throwing, so "Paste" above stays quiet instead of
                                showing the error banner.
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
