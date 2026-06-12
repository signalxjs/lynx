/**
 * `<UpdatePrompt>` — modal offering an optional (non-mandatory) update.
 *
 * Shows automatically when the headless state reaches `status: 'available'`
 * with `mandatory: false`, unless the user already dismissed this update id
 * (persisted via `@sigx/lynx-storage`, see `dismissals.ts`). Mandatory
 * updates never prompt — `<UpdateGate>` owns those.
 *
 * - **Update** → `Updates.download()`; with `applyOn="restart"` it then
 *   `Updates.apply()`s immediately (in-place reload). The default
 *   `'next-launch'` leaves the staged update for the next cold start.
 * - **Later** → hides the modal and suppresses re-prompts for this update id.
 */

import { component, signal, watch, type Define } from '@sigx/lynx';
import { Button, Modal } from '@sigx/lynx-daisyui';
import { Updates, useUpdates } from '@sigx/lynx-updates';
import { dismiss, isDismissed } from './dismissals.js';

/** When the downloaded update takes effect after tapping "Update". */
export type UpdateApplyOn = 'restart' | 'next-launch';

export type UpdatePromptProps =
    /** Apply timing after a successful download. Default `'next-launch'`. */
    & Define.Prop<'applyOn', UpdateApplyOn, false>
    /** Modal headline. Default `'Update available'`. */
    & Define.Prop<'title', string, false>
    /** Extra class for the modal box. */
    & Define.Prop<'class', string, false>
    /** Fired when the user taps "Later" (or the backdrop). */
    & Define.Event<'dismiss', void>;

export const UpdatePrompt = component<UpdatePromptProps>(({ props, emit }) => {
    const updates = useUpdates();
    /** Update id the modal is allowed to show for (post dismissal check). */
    const visibleForId = signal<string | null>(null);
    const busy = signal(false);

    // When a non-mandatory update becomes available, check the persisted
    // dismissals before showing. Hide whenever the state moves on.
    watch(
        () => {
            const s = updates.value;
            return s.status === 'available' && !s.mandatory ? (s.manifest?.id ?? null) : null;
        },
        (id) => {
            if (!id) {
                visibleForId.value = null;
                return;
            }
            void isDismissed(id).then((suppressed) => {
                const s = updates.value;
                if (!suppressed && s.status === 'available' && s.manifest?.id === id) {
                    visibleForId.value = id;
                }
            });
        },
        { immediate: true },
    );

    const later = () => {
        const id = updates.value.manifest?.id;
        visibleForId.value = null;
        if (id) void dismiss(id);
        emit('dismiss');
    };

    const update = () => {
        if (busy.value) return;
        busy.value = true;
        void Updates.download()
            .then(() => (props.applyOn === 'restart' ? Updates.apply() : undefined))
            // Failures transition the headless state to 'error'; nothing to
            // surface here beyond closing the prompt.
            .catch(() => {})
            .finally(() => {
                busy.value = false;
                visibleForId.value = null;
            });
    };

    return () => {
        const s = updates.value;
        const manifest = s.manifest;
        const open = s.status === 'available'
            && !s.mandatory
            && manifest != null
            && visibleForId.value === manifest.id;
        const notes = manifest?.metadata?.releaseNotes;

        return (
            <Modal open={open} onClose={later} class={props.class}>
                <Modal.Header>
                    <text class="text-lg font-bold">{props.title ?? 'Update available'}</text>
                </Modal.Header>
                <Modal.Body>
                    <text>{`Version ${manifest?.version ?? ''}`}</text>
                    {notes
                        ? <text class="text-sm opacity-70" style={{ marginTop: '8px' }}>{notes}</text>
                        : null}
                </Modal.Body>
                <Modal.Actions>
                    <Button variant="ghost" onPress={later}>Later</Button>
                    <Button color="primary" loading={busy.value} onPress={update}>Update</Button>
                </Modal.Actions>
            </Modal>
        );
    };
});
