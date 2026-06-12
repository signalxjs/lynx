/**
 * `<UpdateGate>` — wraps app content and blocks it behind a full-screen
 * overlay while a mandatory update installs.
 *
 * Children render normally at all times; when `state.mandatory` flips true
 * (the headless package saw a `mandatory: true` manifest) a full-screen
 * overlay covers them with a centered title + description, a progress bar
 * while downloading, "Installing…" while applying, and a Retry button when
 * the download failed.
 *
 * ```tsx
 * <UpdateGate description="A required update is being installed.">
 *   <App />
 * </UpdateGate>
 * ```
 *
 * Bring your own blocked screen via the named `blocked` slot:
 *
 * ```tsx
 * <UpdateGate slots={{ blocked: () => <MyBlockedScreen /> }}>
 *   <App />
 * </UpdateGate>
 * ```
 */

import { component, type Define } from '@sigx/lynx';
import { Button, Progress } from '@sigx/lynx-daisyui';
import { Updates, useUpdates } from '@sigx/lynx-updates';
import { downloadPercent } from './format.js';

export type UpdateGateProps =
    /** Overlay headline. Default `'Update required'`. */
    & Define.Prop<'title', string, false>
    /** Optional copy under the headline. */
    & Define.Prop<'description', string, false>
    /** Extra class for the overlay container. */
    & Define.Prop<'class', string, false>
    /** App content — always mounted. */
    & Define.Slot<'default'>
    /** Escape hatch: replaces the built-in blocked overlay entirely. */
    & Define.Slot<'blocked'>;

const OVERLAY_STYLE = {
    position: 'fixed',
    top: '0px',
    left: '0px',
    right: '0px',
    bottom: '0px',
    backgroundColor: 'var(--color-base-100)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    padding: '32px',
} as const;

export const UpdateGate = component<UpdateGateProps>(({ props, slots }) => {
    const updates = useUpdates();

    const retry = () => {
        // Errors also land in the reactive state; swallow the rejection here.
        void Updates.download().catch(() => {});
    };

    return () => {
        const state = updates.value;
        // The slots proxy yields a callable for ANY name; an unprovided slot
        // returns an empty array — so presence is "produced content", not
        // "slots.blocked is defined".
        const custom = state.mandatory ? slots.blocked?.() : null;
        const hasCustom = Array.isArray(custom) ? custom.length > 0 : custom != null;
        return (
            <view style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, flexShrink: 1 }}>
                {slots.default?.()}
                {state.mandatory
                    ? (hasCustom
                        ? custom
                        : (
                            <view
                                class={`update-gate-overlay${props.class ? ' ' + props.class : ''}`}
                                style={OVERLAY_STYLE}
                            >
                                <text class="text-xl font-bold">{props.title ?? 'Update required'}</text>
                                {props.description
                                    ? (
                                        <text
                                            class="text-sm opacity-70"
                                            style={{ marginTop: '8px', textAlign: 'center' }}
                                        >
                                            {props.description}
                                        </text>
                                    )
                                    : null}
                                {state.status === 'downloading'
                                    ? (
                                        <view style={{ alignSelf: 'stretch', marginTop: '24px' }}>
                                            <Progress value={downloadPercent(state.progress) ?? 0} />
                                        </view>
                                    )
                                    : null}
                                {state.status === 'applying'
                                    ? <text class="text-sm opacity-70" style={{ marginTop: '24px' }}>Installing…</text>
                                    : null}
                                {state.status === 'error'
                                    ? (
                                        <view style={{ marginTop: '24px' }}>
                                            <Button color="primary" onPress={retry}>Retry</Button>
                                        </view>
                                    )
                                    : null}
                            </view>
                        ))
                    : null}
            </view>
        );
    };
});
