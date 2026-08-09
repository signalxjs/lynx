import './css-engine-probe.css';
import './css-engine-probe-font-data.css';
import { component, signal, useScreen } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';

/**
 * #951 — CSS engine probe for the Lynx 4.0 at-rules.
 *
 * Every bar is a verdict: GREEN = the feature resolved, HOT PINK = it did
 * not (for the "must NOT match" @supports gates, pink = a false positive).
 * The probes live in css-engine-probe.css with unscoped-unique `p951-*`
 * classes; this component is deliberately plain `<view>`/`<text>` so the
 * body also renders from the stripped-down probe entry (`probe-main.tsx`)
 * with no ThemeProvider/AppearanceProvider in the tree — required for the
 * first-paint arms of the device matrix.
 *
 * The font probe text is three Font Awesome codepoints (heart, star,
 * smile): visible glyphs = the @font-face loaded; tofu/blank = it didn't.
 */

const FONT_PROBE_TEXT = '\uf004 \uf005 \uf118';

function readEngineFacts(): { colorScheme: string; pixels: string } {
    // Raw reads on purpose: no AppearanceProvider in the probe entry.
    const g = (
        (globalThis as Record<string, unknown>)['lynx'] as
            | { __globalProps?: Record<string, unknown> }
            | undefined
    )?.__globalProps;
    const appearance = g?.['appearance'] as
        | { colorScheme?: string }
        | undefined;
    const si = (globalThis as Record<string, unknown>)['SystemInfo'] as
        | { pixelWidth?: number; pixelHeight?: number; pixelRatio?: number }
        | undefined;
    return {
        colorScheme: appearance?.colorScheme ?? '(unset)',
        pixels: si
            ? `${si.pixelWidth ?? '?'}×${si.pixelHeight ?? '?'} @${si.pixelRatio ?? '?'}x`
            : '(no SystemInfo)',
    };
}

const Swatch = component<{ cls: string; label: string }>(({ props }) => {
    return () => (
        <view class={`p951-swatch ${props.cls}`}>
            <text class="p951-swatch-label">{props.label}</text>
        </view>
    );
});

/** The probe surface itself — shared by the routed screen and probe-main. */
export const CSSEngineProbeBody = component(() => {
    const facts = signal(readEngineFacts());
    const tick = signal({ n: 0 });
    const refresh = () => {
        Object.assign(facts, readEngineFacts());
        tick.n++;
    };

    return () => (
        <view style={{ padding: '12px', paddingBottom: '48px' }}>
            <text class="p951-section">
                Engine facts (JS view — tap to re-read)
            </text>
            <view bindtap={refresh}>
                <text class="p951-note">
                    globalProps colorScheme: {facts.colorScheme} · SystemInfo:{' '}
                    {facts.pixels} · reads: {String(tick.n)}
                </text>
            </view>

            <text class="p951-section">1 · prefers-color-scheme</text>
            <text class="p951-note">
                Exactly one green, naming the scheme the engine resolved. Both
                pink = @media not working.
            </text>
            <Swatch cls="p951-dark-green" label="green when DARK" />
            <Swatch cls="p951-light-green" label="green when LIGHT" />

            <text class="p951-section">2 · custom properties</text>
            <view class="p951-var-parent">
                <Swatch
                    cls="p951-var-child"
                    label="B · var() from stylesheet parent"
                />
            </view>
            <view class="p951-var-scheme-parent">
                <Swatch
                    cls="p951-var-scheme-child"
                    label="C · var() declared inside @media scheme (green=light teal=dark)"
                />
            </view>
            <view style={{ '--p951-inline': '#16a34a' } as never}>
                <Swatch
                    cls="p951-var-inline-child"
                    label="A · var() from inline declaration (enableCSSInlineVariables)"
                />
            </view>

            <text class="p951-section">3 · width / orientation</text>
            <Swatch cls="p951-wide-600" label="green when width ≥ 600px" />
            <Swatch
                cls="p951-wide-2000"
                label="must stay GREEN (pink = 2000px matched)"
            />
            <Swatch cls="p951-narrow-600" label="green when width ≤ 599px" />
            <Swatch cls="p951-landscape" label="green when LANDSCAPE" />
            <Swatch cls="p951-portrait" label="green when PORTRAIT" />

            <text class="p951-section">4 · @font-face</text>
            <text class="p951-note">
                Glyphs (heart/star/smile) = face loaded; tofu or blank = not
                loaded. Bottom row is the system-font control.
            </text>
            <text class="p951-font-url">url() · {FONT_PROBE_TEXT}</text>
            <text class="p951-font-data">data: · {FONT_PROBE_TEXT}</text>
            <text class="p951-font-control">ctrl · {FONT_PROBE_TEXT}</text>

            <text class="p951-section">5 · @supports</text>
            <Swatch
                cls="p951-sup-pos"
                label="(background-color: #fff) — must be green"
            />
            <Swatch
                cls="p951-sup-neg"
                label="(foo: bar) — pink = false positive"
            />
            <Swatch
                cls="p951-sup-not"
                label="not (foo: bar) — must be green"
            />
            <Swatch
                cls="p951-sup-oklch"
                label="(color: oklch(…)) — pink = engine claims oklch"
            />
        </view>
    );
});

export const CSSEngineProbe = component(() => {
    const screen = useScreen();
    return () => (
        <scroll-view scroll-y style={{ flex: '1' }} class="bg-base-100">
            <Screen title="CSS engine probe" />
            <text
                class="p951-note"
                style={{ paddingLeft: '12px', paddingRight: '12px', paddingTop: '12px' }}
            >
                useScreen: {String(screen.value.width)}×
                {String(screen.value.height)}{' '}
                {screen.value.isLandscape ? 'landscape' : 'portrait'}
            </text>
            <CSSEngineProbeBody />
        </scroll-view>
    );
});
