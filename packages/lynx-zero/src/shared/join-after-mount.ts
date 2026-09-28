/**
 * Join a parent's registry a microtask after mount — for a part whose
 * presence changes how its PARENT renders (a divider's Label, a stats
 * item's Figure).
 *
 * A child mounts while its parent's render is still running, and a signal
 * write made then does not re-run that render; a write a microtask later
 * does. `Promise.resolve().then`, not `queueMicrotask`: the lynx background
 * thread lacks the bare global on some engines.
 *
 * Returns the leave function to hand to `onUnmounted`. Leaving is deferred
 * the same way — a child unmounts inside its parent's render too — and
 * unmounting before the join has run cancels it, so nothing is left
 * registered.
 */
export function joinAfterMount(onMounted: (fn: () => void) => void, join: () => () => void): () => void {
    let leave: (() => void) | null = null;
    let gone = false;
    onMounted(() => {
        void Promise.resolve().then(() => {
            if (!gone) leave = join();
        });
    });
    return () => {
        gone = true;
        const done = leave;
        leave = null;
        if (done) void Promise.resolve().then(done);
    };
}
