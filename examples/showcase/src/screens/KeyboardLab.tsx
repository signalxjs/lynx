import { component, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Badge, Button, Col, Input, Row, ScrollView, Text } from '@sigx/lynx-daisyui';
import { KeyboardAvoidingView, KeyboardStickyView, useKeyboard } from '@sigx/lynx-keyboard';

/**
 * Keyboard lab — exercises `@sigx/lynx-keyboard` in the proven chat-screen
 * shape:
 *
 *  • The message area sits in `<KeyboardAvoidingView behavior="padding">`,
 *    so it shrinks by the keyboard overlap and nothing hides behind the IME.
 *  • The composer bar (accessory toolbar + input) sits in
 *    `<KeyboardStickyView>`, riding the keyboard's top edge with an
 *    MT-animated translateY.
 *  • Both compute the same lift (`max(0, keyboard − bottomInset)`), so the
 *    list bottom always ends exactly where the bar lands.
 *
 * Focus the input to bring up the keyboard (on the iOS Simulator, toggle the
 * software keyboard with Cmd+K if a hardware keyboard is connected).
 *
 * Presented as a modal: the lift math assumes the bar sits directly above
 * the bottom safe-area inset. Inside a tab navigator the tab bar adds extra
 * space below the bar — compensate with `offset={tabBarHeight}` on
 * `<KeyboardStickyView>` (and add the same to the avoiding view's
 * `keyboardVerticalOffset`) if you need a sticky composer on a tab screen.
 */

const SEED: Array<{ own: boolean; text: string }> = [
    { own: false, text: 'The bar below is a KeyboardStickyView.' },
    { own: true, text: 'So when the keyboard opens, it rides the top edge?' },
    { own: false, text: 'Exactly — MT-animated translateY, no layout reflow.' },
    { own: false, text: 'And this list lives in a KeyboardAvoidingView with behavior="padding", so it shrinks by the same lift instead of disappearing behind the IME.' },
    { own: true, text: 'The toolbar slots into the same bar — like an InputAccessoryView.' },
    { own: false, text: 'Type something below and watch the whole bar travel with the keyboard.' },
];

export const KeyboardLab = component(() => {
    const kb = useKeyboard();
    const input = signal('');
    const messages = signal<Array<{ own: boolean; text: string }>>([...SEED]);

    const send = (): void => {
        const text = input.value.trim();
        if (!text) return;
        messages.$set([...messages, { own: true, text }]);
        input.value = '';
    };

    /**
     * Accessory-toolbar action: append a markdown snippet to the input model.
     * The bound signal updates (Send posts the inserted text), but the native
     * <input> doesn't repaint from programmatic value writes yet (#143).
     */
    const insert = (snippet: string): void => {
        input.value = input.value + snippet;
    };

    return () => (
        <Col class="flex-fill bg-base-100">
            <Screen title="Keyboard lab" />
            <KeyboardAvoidingView behavior="padding">
                <ScrollView class="flex-1">
                    <Col gap={8} padding={12}>
                        <Row gap={8} align="center" justify="center" class="py-1">
                            <Badge variant={kb.value.visible ? 'primary' : 'ghost'}>
                                {kb.value.visible ? `keyboard: ${kb.value.height}px` : 'keyboard hidden'}
                            </Badge>
                        </Row>
                        {messages.map((m) => (
                            <Row justify={m.own ? 'flex-end' : 'flex-start'} class="px-1">
                                <view class={`rounded-2xl px-3 py-2 max-w-[80%] ${m.own ? 'bg-primary' : 'bg-base-200'}`}>
                                    <Text class={m.own ? 'text-primary-content' : ''}>{m.text}</Text>
                                </view>
                            </Row>
                        ))}
                    </Col>
                </ScrollView>
            </KeyboardAvoidingView>
            <KeyboardStickyView>
                <Col class="border-t border-base-300 bg-base-100">
                    {/* Accessory toolbar — rides the keyboard with the input. */}
                    <Row gap={4} class="px-2 pt-2">
                        <Button size="sm" variant="ghost" onPress={() => insert('**bold** ')}>
                            <Text weight="bold">B</Text>
                        </Button>
                        <Button size="sm" variant="ghost" onPress={() => insert('_italic_ ')}>
                            <Text class="italic">I</Text>
                        </Button>
                        <Button size="sm" variant="ghost" onPress={() => insert('`code` ')}>
                            <Text>{'</>'}</Text>
                        </Button>
                        <Button size="sm" variant="ghost" onPress={() => insert('- list item\n')}>
                            <Text>•—</Text>
                        </Button>
                    </Row>
                    <Row gap={8} align="flex-end" class="p-2">
                        <view class="flex-1">
                            <Input placeholder="Type a message…" model={() => input.value} />
                        </view>
                        <Button variant="primary" onPress={send}>
                            Send
                        </Button>
                    </Row>
                </Col>
            </KeyboardStickyView>
        </Col>
    );
});
