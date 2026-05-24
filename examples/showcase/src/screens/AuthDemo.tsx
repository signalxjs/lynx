import { component, onMounted, signal } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import {
    Button,
    Card,
    Col,
    Heading,
    Input,
    Row,
    ScrollView,
    Text,
} from '@sigx/lynx-daisyui';
import { Haptics } from '@sigx/lynx-haptics';
import { Biometric } from '@sigx/lynx-biometric';
import { SecureStorage } from '@sigx/lynx-secure-storage';

type AuthState = 'signed-out' | 'locked' | 'unlocked';

const TOKEN_KEY = 'access_token';
const BIOMETRIC_REASON = 'Unlock your showcase account';
const BIOMETRIC_TITLE = 'Showcase';

export const AuthDemo = component(() => {
    const username = signal('');
    const password = signal('');
    const state = signal<AuthState>('signed-out');
    const revealedToken = signal<string | null>(null);
    const status = signal<string>('Ready.');
    const availability = signal<{ available: boolean; type: string }>({
        available: false,
        type: 'none',
    });
    const hasToken = signal<boolean>(false);

    const refreshDiagnostics = async () => {
        const next = await Biometric.isAvailable();
        availability.$set({ available: next.available, type: next.type });
        if (SecureStorage.isAvailable()) {
            hasToken.value = await SecureStorage.hasKey(TOKEN_KEY);
        }
    };

    onMounted(async () => {
        await refreshDiagnostics();
        // Returning user — token already in secure storage.
        if (hasToken.value) {
            state.value = 'locked';
            status.value = 'Existing session found. Unlock to reveal token.';
        }
    });

    const onSignIn = async () => {
        Haptics.selection();
        const user = username.value.trim();
        const pass = password.value;
        if (!user || !pass) {
            status.value = 'Username and password required.';
            return;
        }
        status.value = 'Signing in…';
        // Simulated backend call. In a real app this would POST to /login
        // and receive a token (plus refresh token).
        await new Promise((r) => setTimeout(r, 500));
        const token = `demo.${user}.${Math.random().toString(36).slice(2, 10)}`;
        try {
            await SecureStorage.set(TOKEN_KEY, token, { requireBiometric: true });
            Haptics.notification('success');
            password.value = '';
            state.value = 'locked';
            revealedToken.value = null;
            hasToken.value = true;
            status.value = 'Signed in. Token encrypted at rest and gated by biometrics.';
        } catch (err) {
            Haptics.notification('error');
            status.value = `Sign-in failed: ${(err as Error).message}`;
        }
    };

    const onUnlock = async () => {
        Haptics.selection();
        status.value = 'Authenticating…';
        // Two-step unlock — explicit Biometric.authenticate first, then the
        // OS prompts a second time when we actually decrypt the Keychain
        // item. A real app would skip the first step and rely solely on
        // the storage-level prompt; we do both here to demonstrate each
        // package independently.
        const auth = await Biometric.authenticate({
            reason: BIOMETRIC_REASON,
            title: BIOMETRIC_TITLE,
            fallbackTitle: 'Use Passcode',
            allowDeviceCredential: true,
        });
        if (!auth.success) {
            Haptics.notification('warning');
            status.value = `Auth failed: ${auth.errorCode ?? 'unknown'} — ${auth.error ?? ''}`;
            return;
        }
        try {
            const token = await SecureStorage.get(TOKEN_KEY, {
                biometricPrompt: {
                    reason: BIOMETRIC_REASON,
                    title: BIOMETRIC_TITLE,
                },
            });
            if (token == null) {
                state.value = 'signed-out';
                hasToken.value = false;
                status.value = 'Stored token missing — please sign in again.';
                return;
            }
            Haptics.notification('success');
            revealedToken.value = token;
            state.value = 'unlocked';
            status.value = 'Unlocked. Token decrypted from Keychain / Keystore.';
        } catch (err) {
            Haptics.notification('warning');
            status.value = `Decrypt failed: ${(err as Error).message}`;
        }
    };

    const onLock = () => {
        Haptics.selection();
        revealedToken.value = null;
        state.value = 'locked';
        status.value = 'Locked. Tap Unlock to reveal again.';
    };

    const onSignOut = async () => {
        Haptics.selection();
        try {
            await SecureStorage.delete(TOKEN_KEY);
        } catch {
            // Ignore — we're moving back to signed-out either way.
        }
        revealedToken.value = null;
        state.value = 'signed-out';
        username.value = '';
        password.value = '';
        hasToken.value = false;
        status.value = 'Signed out. Token deleted from secure storage.';
    };

    return () => (
        <ScrollView class="flex-fill bg-base-100">
            <Screen title="Auth demo" />
            <Col gap={16} padding={16}>
                <Heading level={2}>Auth demo</Heading>
                <Text class="opacity-60 text-sm">
                    Sign-in → encrypted token → biometric unlock round-trip
                    using @sigx/lynx-biometric and @sigx/lynx-secure-storage.
                </Text>

                {state.value === 'signed-out' && (
                    <Card bordered>
                        <Card.Body>
                            <Col gap={12}>
                                <Text weight="semibold">Sign in</Text>
                                <Text class="opacity-60 text-sm">
                                    No real backend — submitting generates a
                                    fake token and stores it with
                                    requireBiometric: true.
                                </Text>
                                <Input
                                    placeholder="Username"
                                    model={() => username.value}
                                />
                                <Input
                                    placeholder="Password"
                                    model={() => password.value}
                                />
                                <Button variant="primary" onPress={onSignIn}>
                                    Sign in
                                </Button>
                            </Col>
                        </Card.Body>
                    </Card>
                )}

                {state.value === 'locked' && (
                    <Card bordered>
                        <Card.Body>
                            <Col gap={12}>
                                <Text weight="semibold">Locked</Text>
                                <Text class="opacity-60 text-sm">
                                    A token is in secure storage. Unlock with
                                    biometrics to reveal it.
                                </Text>
                                <Row gap={8}>
                                    <Button variant="primary" onPress={onUnlock}>
                                        Unlock with biometrics
                                    </Button>
                                    <Button variant="ghost" onPress={onSignOut}>
                                        Sign out
                                    </Button>
                                </Row>
                            </Col>
                        </Card.Body>
                    </Card>
                )}

                {state.value === 'unlocked' && (
                    <Card bordered>
                        <Card.Body>
                            <Col gap={12}>
                                <Text weight="semibold">Unlocked</Text>
                                <Text class="opacity-60 text-sm">
                                    Token decrypted from the Keychain /
                                    Keystore. In a real app you'd attach this
                                    to an Authorization header and keep it in
                                    memory only.
                                </Text>
                                <Text selectable class="font-mono text-sm">
                                    {revealedToken.value ?? '—'}
                                </Text>
                                <Row gap={8}>
                                    <Button variant="ghost" onPress={onLock}>
                                        Lock
                                    </Button>
                                    <Button variant="ghost" onPress={onSignOut}>
                                        Sign out
                                    </Button>
                                </Row>
                            </Col>
                        </Card.Body>
                    </Card>
                )}

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Status</Text>
                            <Text class="font-mono text-sm opacity-70">
                                {status.value}
                            </Text>
                        </Col>
                    </Card.Body>
                </Card>

                <Card bordered>
                    <Card.Body>
                        <Col gap={8}>
                            <Text weight="semibold">Diagnostics</Text>
                            <Text class="font-mono text-sm opacity-70">
                                Biometric.isAvailable: {String(availability.available)}{'\n'}
                                Biometric.type: {availability.type}{'\n'}
                                SecureStorage.isAvailable: {String(SecureStorage.isAvailable())}{'\n'}
                                hasKey({TOKEN_KEY}): {String(hasToken.value)}
                            </Text>
                            <Button
                                size="sm"
                                variant="ghost"
                                outline
                                onPress={() => { void refreshDiagnostics(); }}
                            >
                                Refresh
                            </Button>
                        </Col>
                    </Card.Body>
                </Card>
            </Col>
        </ScrollView>
    );
});
