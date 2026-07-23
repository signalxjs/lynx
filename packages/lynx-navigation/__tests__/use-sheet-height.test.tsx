/**
 * `useSheetHeight` (#708) — public bindable SV of the top sheet's live height.
 *
 * Since the reveal-px conversion (#774) the navigator's dedicated sheet SV
 * *is* the visible height in px, so the hook returns it directly — no
 * progress→px derivation, no reactive factor rebind. Here we lock the BG
 * surface: the hook is callable under a `<NavigationRoot>` and returns the
 * navigator's sheet reveal SV; with animations disabled it is a constant 0.
 * End-to-end height tracking needs the MT worklet runtime (device / MT tests).
 */
import { describe, expect, it } from 'vitest';
import { component, SharedValue } from '@sigx/lynx';
import { render } from '@sigx/lynx-testing';
import { NavigationRoot } from '../src/components/NavigationRoot';
import { Stack } from '../src/components/Stack';
import { useNavInternals, type NavInternals } from '../src/hooks/use-nav-internal';
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

  it('returns the navigator sheet reveal SV itself when animated', () => {
    let sh: SharedValue<number> | null = null;
    let internals: NavInternals | null = null;
    const Probe = component(() => {
      sh = useSheetHeight();
      internals = useNavInternals();
      return () => null;
    });
    render(
      <NavigationRoot routes={routes} initialRoute="home">
        <Probe />
        <Stack />
      </NavigationRoot>,
    );
    // Reveal px IS the visible height — same SV, no derivation layer.
    expect(sh).toBe(internals!.sheetReveal);
  });
});
