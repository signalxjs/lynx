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
        // contract calls it `message` (matches React Native). Send both so
        // either side stays correct as the modules are updated.
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
