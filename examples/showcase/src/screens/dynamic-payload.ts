/**
 * Loaded exclusively via dynamic `import()` from DynamicImportDemo — the
 * bundler emits it as an async chunk (`dist/static/js/async/<hash>.js`), which
 * is exactly the artifact #599 is about: served by the dev server in `sigx
 * dev`, loaded from embedded assets in standalone builds.
 */
export function describePayload(): string {
    return `Loaded from an async chunk 🎉 (fib(30) = ${fibonacci(30)})`;
}

function fibonacci(n: number): number {
    let a = 0;
    let b = 1;
    for (let i = 0; i < n; i++) [a, b] = [b, a + b];
    return a;
}
