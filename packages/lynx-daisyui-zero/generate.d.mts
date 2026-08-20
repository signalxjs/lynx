/** Hand-kept declarations for the build-time generator (see generate.mjs). */

export function bakeSwatch(
    swatch: Record<string, string>,
    themeName: string,
): Record<string, string>;

export interface LynxSkinManifest {
    name: string;
    target: string;
    classGrammarVersion: number;
    zeroVersion?: string;
    themes: Array<{
        name: string;
        colorScheme: 'light' | 'dark';
        pair?: string;
        swatch?: Record<string, string>;
    }>;
    components?: Record<string, {
        defaults?: Record<string, string>;
        axes?: Record<string, string[]>;
        [key: string]: unknown;
    }>;
}

export function generateThemeData(
    manifest: LynxSkinManifest,
    expectedGrammarVersion: number,
): string;
