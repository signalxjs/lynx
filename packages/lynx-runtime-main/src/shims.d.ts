/**
 * Lynx PAPI (Platform API) globals injected by the Lynx runtime on the Main
 * Thread (Lepus). The Background Thread uses ShadowElement + op-queue instead.
 *
 * @lynx-js/types provides higher-level typed interfaces (Element, Lynx, events)
 * but does NOT declare these low-level PAPI globals. We declare them here with
 * an opaque branded type so call sites get nominal safety without `any` casts.
 *
 * Script-style .d.ts (no imports/exports) so declarations are global and the
 * file isn't re-emitted into dist/ (which would clash with the source on
 * root-level typecheck).
 */

/**
 * Opaque branded handle returned by PAPI element-creation functions.
 * Prevents accidental mixing with plain objects while remaining compatible
 * with all PAPI mutation functions that accept element handles.
 */
type MainThreadElement = { readonly __brand: 'MainThreadElement' }

// Element creation — typed creators for known element types
declare function __CreateElement(tag: string, parentID?: number): MainThreadElement
declare function __CreateView(parentID: number): MainThreadElement
declare function __CreateText(parentID: number): MainThreadElement
declare function __CreateImage(parentID: number): MainThreadElement
declare function __CreateScrollView(parentID: number): MainThreadElement
declare function __CreateRawText(text: string): MainThreadElement
declare function __CreatePage(cssId?: string, scope?: number): MainThreadElement

// Native <list> recycler. `componentAtIndex` is invoked by native to realise
// the cell at `cellIndex` — it must return that element's unique id (sign).
// `enqueueComponent` is invoked when a cell scrolls offscreen and may be
// recycled. See list-mt.ts and Lynx's fiber list element API.
type ComponentAtIndexCallback = (
  list: MainThreadElement,
  listID: number,
  cellIndex: number,
  operationID: number,
  enableReuseNotification: boolean,
) => number
type EnqueueComponentCallback = (
  list: MainThreadElement,
  listID: number,
  sign: number,
) => void
declare function __CreateList(
  parentComponentUniqueId: number,
  componentAtIndex: ComponentAtIndexCallback,
  enqueueComponent: EnqueueComponentCallback,
): MainThreadElement
declare function __UpdateListCallbacks(
  list: MainThreadElement,
  componentAtIndex: ComponentAtIndexCallback | null,
  enqueueComponent: EnqueueComponentCallback | null,
): void

// Tree mutations
declare function __AppendElement(parent: MainThreadElement, child: MainThreadElement): void
declare function __InsertElementBefore(parent: MainThreadElement, child: MainThreadElement, anchor: MainThreadElement): void
declare function __RemoveElement(parent: MainThreadElement, child: MainThreadElement): void

// Attributes / styles / classes
declare function __SetAttribute(element: MainThreadElement, key: string, value: unknown): void
declare function __AddInlineStyle(element: MainThreadElement, key: string, value: unknown): void
declare function __SetInlineStyles(element: MainThreadElement, styles: string | object): void
declare function __SetClasses(element: MainThreadElement, classes: string): void
declare function __SetID(element: MainThreadElement, id: string | undefined): void
declare function __SetCSSId(elements: MainThreadElement[], cssId: number): void
declare function __AddDataset(element: MainThreadElement, key: string, value: unknown): void

// Events
declare function __AddEvent(element: MainThreadElement, eventType: string, eventName: string, sign: string | undefined): void
declare function __RemoveEvent(element: MainThreadElement, event: string): void

// Text
declare function __UpdateRawText(node: MainThreadElement, text: string): void

// Navigation
declare function __GetParent(node: MainThreadElement): MainThreadElement | null
declare function __FirstElement(parent: MainThreadElement): MainThreadElement | null
declare function __NextElement(node: MainThreadElement): MainThreadElement | null
declare function __GetTag(element: MainThreadElement): string
declare function __GetElementUniqueID(element: MainThreadElement): number

// Flush. The optional `options` form routes a single-cell render back to a
// native <list> (operationID/elementID/listID) — see list-mt.ts.
interface FlushElementTreeOptions {
  triggerLayout?: boolean
  operationID?: number
  elementID?: number
  listID?: number
  asyncFlush?: boolean
  listReuseNotification?: { listElement: MainThreadElement; itemKey?: string }
}
declare function __FlushElementTree(
  root?: MainThreadElement,
  options?: FlushElementTreeOptions,
): void

// Gesture detector
declare function __SetGestureDetector(
  element: MainThreadElement,
  gestureId: number,
  type: number,
  config: { callbacks: { name: string; callback: unknown }[]; config?: Record<string, unknown> },
  relationMap: { waitFor: number[]; simultaneous: number[]; continueWith: number[] },
): void
declare function __RemoveGestureDetector(element: MainThreadElement, gestureId: number): void

// Attribute / selector / UI-method introspection (Phase 1d, for
// MTElementWrapper parity with upstream's Element class)
declare function __GetAttributeByName(element: MainThreadElement, name: string): unknown
declare function __GetAttributeNames(element: MainThreadElement): string[]
declare function __GetComputedStyleByKey(element: MainThreadElement, key: string): string
declare function __QuerySelector(
  element: MainThreadElement,
  selector: string,
  options: Record<string, unknown>,
): MainThreadElement | null
declare function __QuerySelectorAll(
  element: MainThreadElement,
  selector: string,
  options: Record<string, unknown>,
): MainThreadElement[]
declare function __InvokeUIMethod(
  element: MainThreadElement,
  methodName: string,
  params: Record<string, unknown>,
  callback: (res: { code: number; data: unknown }) => void,
): void
