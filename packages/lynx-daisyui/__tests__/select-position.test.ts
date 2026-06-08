import { describe, it, expect } from 'vitest';
import { placeSelectDropdown } from '../src/forms/select-position';

const SCREEN = 800;

describe('placeSelectDropdown', () => {
  it('opens below the trigger when there is room', () => {
    const pos = placeSelectDropdown({
      trigger: { top: 100, left: 20, width: 300, height: 44 },
      screenHeight: SCREEN,
      optionCount: 3,
    });
    expect(pos.openUp).toBe(false);
    expect(pos.top).toBe(100 + 44 + 4); // trigger bottom + gap
    expect(pos.bottom).toBeUndefined();
    expect(pos.left).toBe(20);
    expect(pos.width).toBe(300);
  });

  it('flips above the trigger when there is no room below', () => {
    const pos = placeSelectDropdown({
      trigger: { top: 740, left: 0, width: 300, height: 44 },
      screenHeight: SCREEN,
      optionCount: 4,
    });
    expect(pos.openUp).toBe(true);
    // Anchored by its bottom edge, a gap above the trigger's top.
    expect(pos.bottom).toBe(SCREEN - 740 + 4);
    expect(pos.top).toBeUndefined();
  });

  it('clamps maxHeight when it opens down but the menu does not fully fit', () => {
    // Short screen: below has the most room but still less than desired, and
    // above has even less — so it stays down, clamped + internally scrollable.
    const pos = placeSelectDropdown({
      trigger: { top: 200, left: 0, width: 300, height: 44 },
      screenHeight: 500,
      optionCount: 10, // desired capped at 280
    });
    expect(pos.openUp).toBe(false);
    // spaceBelow = 500 - (200 + 44) - 4 = 252; spaceAbove = 196 -> stays down
    expect(pos.maxHeight).toBe(252);
  });

  it('opens down when the (capped) menu fits below even with many options', () => {
    // 20 options cap at 280; spaceBelow = 800 - 464 - 4 = 332 >= 280 -> fits.
    const pos = placeSelectDropdown({
      trigger: { top: 420, left: 0, width: 300, height: 44 },
      screenHeight: SCREEN,
      optionCount: 20,
    });
    expect(pos.openUp).toBe(false);
    expect(pos.maxHeight).toBe(280);
  });

  it('flips up for a near-bottom trigger with plenty of room above', () => {
    // The reported bug: a select low on screen should open upward, not cram
    // into a sliver below. top=813 (~viewport bottom), 3 options.
    const pos = placeSelectDropdown({
      trigger: { top: 813, left: 0, width: 300, height: 18 },
      screenHeight: 923,
      optionCount: 3,
    });
    expect(pos.openUp).toBe(true);
    expect(pos.bottom).toBe(923 - 813 + 4);
    expect(pos.maxHeight).toBe(132); // full 3-row menu fits above
  });

  it('does not return a negative maxHeight', () => {
    const pos = placeSelectDropdown({
      trigger: { top: 798, left: 0, width: 300, height: 44 },
      screenHeight: SCREEN,
      optionCount: 3,
    });
    expect(pos.maxHeight).toBeGreaterThanOrEqual(0);
  });
});
