import { component } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { Button, Card, Col, Heading, ScrollView, Text } from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { Share } from '@sigx/lynx-share';

/**
 * Share — the native share sheet via @sigx/lynx-share.
 */
export const ShareDemo = component(() => {
    // Share.share() is a callSync bridge — it throws when the native module
    // isn't registered, so guard availability and swallow failures.
    const shareText = () => {
        Haptics.selection();
        if (!Share.isAvailable()) return;
        try {
            Share.share({
                title: 'SignalX for Lynx',
                message: 'Built with sigx-lynx — dual-thread rendering on mobile.',
            });
        } catch { /* keep UI alive */ }
    };
    const shareUrl = () => {
        Haptics.selection();
        if (!Share.isAvailable()) return;
        try {
            Share.share({
                title: 'SignalX',
                url: 'https://signalx.dev',
            });
        } catch { /* keep UI alive */ }
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Share" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Share</Heading>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Native share sheet</Text>
                            <Text class="opacity-60 text-sm">
                                Opens the platform share dialog
                                (UIActivityViewController / Intent.createChooser).
                                Available: {String(Share.isAvailable())}.
                            </Text>
                            <Button color="primary" onPress={shareText}>
                                Share a message
                            </Button>
                            <Button color="secondary" variant="outline" onPress={shareUrl}>
                                Share a URL
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
