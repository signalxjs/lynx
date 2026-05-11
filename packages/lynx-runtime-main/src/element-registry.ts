/**
 * Element registry — maps BG-thread ShadowElement IDs to Lynx Main Thread
 * element handles.
 */

/** Map from BG-thread ShadowElement id to Lynx Main Thread element handle */
export const elements = new Map<number, MainThreadElement>();

/**
 * PAPI unique ID of the root PageElement.
 * Passed as `parentComponentUniqueId` to element creation PAPI calls.
 * `__SetCSSId` sets `css_style_sheet_manager_` directly on each element,
 * so CSS rendering works without a ComponentElement ancestor.
 */
export let pageUniqueId = 1;

export function setPageUniqueId(id: number): void {
  pageUniqueId = id;
}
