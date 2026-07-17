/**
 * `useSheetHeight` (#708) — public bindable SV of the top sheet's live height.
 *
 * The progress→px math (`sheetProgress × maxFraction × SCREEN_HEIGHT`) rides
 * the `scale` derived-value reducer, whose folding + reactive factor rebind
 * are covered in `lynx-runtime-main/__tests__/derived-values.test.ts`. Here we
 * lock the BG surface: the hook is callable under a `<NavigationRoot>` and
 * returns a real `SharedValue`; with animations disabled it is a constant 0.
 * End-to-end height tracking needs the MT worklet runtime (device / MT tests).
 */
import { describe, expect, it } from 'vitest';
import { component, SharedValue } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { useSheetHeight } from '../src/hooks/use-sheet-height';
import { routes } from './_fixtures';

describe('useSheetHeight (#708)', () => {
  it('returns a SharedValue callable under <NavigationRoot>', () => {
    let sh: SharedValue<number> | null = null;
    const Probe = component(() => {
      sh = useSheetHeight();
      return () => null;
    });
    render(
      <NavigationRoot routes={routes} initialRoute="home" animated={false}>
        <Probe />
        <Stack />
      </NavigationRoot>,
    );
    expect(sh).toBeInstanceOf(SharedValue);
    // Animations disabled → no sheet SV to track → constant 0.
    expect(sh!.value).toBe(0);
  });
});
