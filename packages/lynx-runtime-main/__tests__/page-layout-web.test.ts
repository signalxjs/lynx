/**
 * Web page-layout default (#709): `renderPage` / `sigxHotReload` give the
 * page element the native-equivalent flex-column context on web only —
 * upstream web-core's page is `display: block`, which collapses `flex: 1`
 * app roots to 0-height. Native builds must not get the override (the
 * `__WEB__` define folds it out; at runtime the guard reads the global).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

type FakeEl = {
  __id: number;
  tag: string;
  style: { setProperty: (k: string, v: string) => void };
};
let uid = 1;
let styleWrites: Array<{ tag: string; prop: string; value: string }> = [];

function makeEl(tag: string): FakeEl {
  const el: FakeEl = {
    __id: uid++,
    tag,
    style: {
      setProperty: (prop, value) => styleWrites.push({ tag, prop, value }),
    },
  };
  return el;
}

beforeAll(async () => {
  vi.stubGlobal('__CreatePage', () => makeEl('page'));
  vi.stubGlobal('__CreateView', () => makeEl('view'));
  vi.stubGlobal('__SetCSSId', () => {});
  vi.stubGlobal('__GetElementUniqueID', (el: FakeEl) => el.__id);
  vi.stubGlobal('__AppendElement', () => {});
  vi.stubGlobal('__FlushElementTree', () => {});
  vi.stubGlobal('__SetInlineStyles', () => {});
  await import('../src/entry-main');
});

beforeEach(() => {
  styleWrites = [];
  delete (globalThis as { __WEB__?: boolean }).__WEB__;
});

const renderPage = (): void =>
  (globalThis as unknown as { renderPage: (d: unknown) => void }).renderPage({});
const hotReload = (): void =>
  (globalThis as unknown as { sigxHotReload: () => void }).sigxHotReload();

describe('page layout defaults', () => {
  it('web: renderPage writes real flex-column properties on the page element', () => {
    (globalThis as { __WEB__?: boolean }).__WEB__ = true;
    renderPage();
    expect(styleWrites.filter((w) => w.tag === 'page')).toEqual([
      { tag: 'page', prop: 'display', value: 'flex' },
      { tag: 'page', prop: 'flex-direction', value: 'column' },
    ]);
  });

  it('web: sigxHotReload re-applies both properties, including on a reused page', () => {
    (globalThis as { __WEB__?: boolean }).__WEB__ = true;
    renderPage(); // create the page…
    styleWrites = [];
    hotReload(); // …then reload reuses the existing page element
    expect(styleWrites.filter((w) => w.tag === 'page')).toEqual([
      { tag: 'page', prop: 'display', value: 'flex' },
      { tag: 'page', prop: 'flex-direction', value: 'column' },
    ]);
  });

  it('native: no style writes on the page', () => {
    renderPage();
    hotReload();
    expect(styleWrites).toHaveLength(0);
  });
});
