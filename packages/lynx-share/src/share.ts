import { callSync, isModuleAvailable } from '@sigx/lynx-core';

const MODULE = 'Share';

export interface ShareOptions {
    title?: string;
    message?: string;
    url?: string;
}

/**
 * Native share dialog APIs.
 *
 * @example
 * ```ts
 * import { Share } from '@sigx/lynx-share';
 *
 * Share.share({ title: 'Check this out', message: 'Built with sigx-lynx!', url: 'https://sigx.dev' });
 * ```
 */
export const Share = {
    share(options: ShareOptions): void {
        // Native modules historically read the body key as `text`; the TS
        // contract calls it `message` (matches React Native's Share API).
        // We send both because the native source sits on each consumer's
        // disk between `sigx prebuild` runs — until a consumer re-runs
        // prebuild against a newer @sigx/lynx-share, the on-disk module
        // may still be the older `text`-only one. The duplication is
        // cheap (one extra string-valued key) and lets the TS contract
        // stay stable across the native-source handoff. Safe to drop
        // after a major version bump that forces a re-prebuild.
        const payload: Record<string, unknown> = { ...options };
        if (options.message !== undefined && payload.text === undefined) {
            payload.text = options.message;
        }
        callSync(MODULE, 'share', payload);
    },

    isAvailable(): boolean {
        return isModuleAvailable(MODULE);
    },
} as const;
