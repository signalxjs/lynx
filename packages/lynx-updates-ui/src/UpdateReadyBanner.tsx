/**
 * `<UpdateReadyBanner>` — bottom banner shown when a non-mandatory update is
 * downloaded and staged (`status: 'ready'`). Offers an immediate in-place
 * restart via `Updates.apply()`, or "Later" to dismiss (the staged update
 * still applies on the next cold launch — that's the headless package's
 * default behavior, nothing to persist here).
 *
 * Mandatory updates never reach this banner; `<UpdateGate>` blocks and
 * auto-applies those.
 */

import { component, signal, type Define } from '@sigx/lynx';
import { Alert, Button } from '@sigx/lynx-daisyui';
import { Updates, useUpdates } from '@sigx/lynx-updates';

export type UpdateReadyBannerProps =
    /** Banner text. Default `'Update ready'` (version is appended). */
    & Define.Prop<'label', string, false>
    /** Restart button text. Default `'Restart'`. */
    & Define.Prop<'restartLabel', string, false>
    /** Extra class for the banner container. */
    & Define.Prop<'class', string, false>
    /** Fired when the user taps "Later". */
    & Define.Event<'dismiss', void>;

export const UpdateReadyBanner = component<UpdateReadyBannerProps>(({ props, emit }) => {
    const updates = useUpdates();
    /** Update id the user dismissed — session-local, the staged update still applies next launch. */
    const hiddenForId = signal<string | null>(null);

    const restart = () => {
        // apply() only ever rejects (success tears the JS context down).
        void Updates.apply().catch(() => {});
    };

    return () => {
        const state = updates.value;
        const manifest = state.manifest;
        const open = state.status === 'ready'
            && !state.mandatory
            && manifest != null
            && hiddenForId.value !== manifest.id;

        if (!open) {
            return <view style={{ position: 'absolute', width: '0px', height: '0px', opacity: 0 }} />;
        }

        const label = (props.label ?? 'Update ready')
            + (manifest.version ? ` — v${manifest.version}` : '');

        return (
            <view
                class={`update-ready-banner${props.class ? ' ' + props.class : ''}`}
                style={{ position: 'fixed', left: '16px', right: '16px', bottom: '16px' }}
            >
                <Alert color="info">
                    <view style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px' }}>
                        <text style={{ flexGrow: 1, flexShrink: 1 }}>{label}</text>
                        <Button size="sm" color="primary" onPress={restart}>
                            {props.restartLabel ?? 'Restart'}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onPress={() => {
                                hiddenForId.value = manifest.id;
                                emit('dismiss');
                            }}
                        >
                            Later
                        </Button>
                    </view>
                </Alert>
            </view>
        );
    };
});
