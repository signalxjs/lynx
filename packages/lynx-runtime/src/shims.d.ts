declare global {
    /**
     * Closure-injected by @lynx-js/runtime-wrapper-webpack-plugin's
     * __init_card_bundle__ wrapper. Shape varies by host so we widen to `any`
     * — individual call sites guard with typeof checks.
     */
    var lynx: any;
    /**
     * Closure-injected by @lynx-js/runtime-wrapper-webpack-plugin alongside
     * `lynx`. Holds host bridges like `tt.publishEvent` for routing MT events
     * back to BG.
     */
    var lynxCoreInject: any;
    /**
     * Build-time constants injected by @sigx/lynx-plugin via source.define.
     */
    const __DEV__: boolean;
}
export {};
