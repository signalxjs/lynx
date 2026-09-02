import './css-engine-probe.css';
import './css-engine-probe-font-data.css';
import { component, signal, useScreen } from '@sigx/lynx';
import { Screen } from '@sigx/lynx-navigation';
import { readGlobalColorScheme } from '@sigx/lynx-appearance';

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
    // readGlobalColorScheme is a plain helper (no provider needed, so
    // probe-main stays provider-free) that reads through the module-scoped
    // `lynx` global. A raw `globalThis.lynx.__globalProps` read here showed
    // a misleading "(unset)" in release builds — that global is not the
    // object the runtime hands BG modules (#990).
    const si = (globalThis as Record<string, unknown>)['SystemInfo'] as
        | { pixelWidth?: number; pixelHeight?: number; pixelRatio?: number }
        | undefined;
    return {
        colorScheme: readGlobalColorScheme() ?? '(unset)',
        pixels: si
            ? `${si.pixelWidth ?? '?'}×${si.pixelHeight ?? '?'} @${si.pixelRatio ?? '?'}x`
            : '(no SystemInfo)',
    };
}

// #949 — `current-color` on <svg>. Standard SVG markup (no __COLOR__
// placeholder): the engine either resolves currentColor from the attribute or
// it does not.
const CC_FILL_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="2" width="20" height="20" rx="4"/></svg>';
const CC_STROKE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"><path d="M4 12h16M12 4v16"/></svg>';
const CC_LITERAL_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#16a34a"><rect x="2" y="2" width="20" height="20" rx="4"/></svg>';

const CcRow = component<{
    label: string;
    svg: string;
    cc?: string;
    hostColor?: string;
}>(({ props }) => {
    return () => (
        <view class="p951-swatch p951-cc-row">
            <svg
                class="p951-cc-svg"
                style={props.hostColor ? { color: props.hostColor } : undefined}
                content={props.svg}
                current-color={props.cc}
            />
            <text class="p951-swatch-label">{props.label}</text>
        </view>
    );
});

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
            <view
                style={
                    {
                        // Depends on a signal so it compiles to a per-render
                        // SET_STYLE op (ThemeProvider's path) instead of a
                        // static snapshot-template style — A vs A2 separates
                        // the two inline-declaration transports.
                        '--p951-inline2':
                            tick.n >= 0 ? '#16a34a' : '#ff00aa',
                    } as never
                }
            >
                <Swatch
                    cls="p951-var-inline2-child"
                    label="A2 · var() from DYNAMIC inline declaration (SET_STYLE op)"
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

            <text class="p951-section">6 · svg current-color (#949)</text>
            <text class="p951-note">
                Each row: a 32px square SVG on a hot-pink bar. GREEN square =
                the engine resolved `currentColor` from the `current-color`
                attribute; anything else (black, blank, pink) = it did not.
            </text>
            <CcRow
                label="A · fill=currentColor + current-color=#16a34a"
                svg={CC_FILL_SVG}
                cc="#16a34a"
            />
            <CcRow
                label="B · stroke=currentColor (lucide shape) + current-color"
                svg={CC_STROKE_SVG}
                cc="#16a34a"
            />
            <view class="p951-cc-parent">
                <CcRow
                    label="C · current-color=var(--p951-cc) from stylesheet parent"
                    svg={CC_FILL_SVG}
                    cc="var(--p951-cc)"
                />
            </view>
            <CcRow
                label="D · fill=currentColor, host color:#16a34a, NO attr (inherit?)"
                svg={CC_FILL_SVG}
                hostColor="#16a34a"
            />
            <CcRow
                label="E · control: fill=#16a34a literal — must be green"
                svg={CC_LITERAL_SVG}
            />
            <CcRow
                label="F · fill=currentColor, nothing set — engine fallback"
                svg={CC_FILL_SVG}
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
