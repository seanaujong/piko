/**
 * Standing in for the browser APIs jsdom leaves out, for the unit suite only.
 *
 * jsdom performs no layout, so it implements no `ResizeObserver` — every element is zero by
 * zero and there would be nothing for one to report. The chip row uses it to ask whether its
 * contents overflow, which is a real question in Chrome and a meaningless one here.
 *
 * A no-op is the honest shim: it keeps the effect from throwing without pretending to answer.
 * Whether the row actually overflows, and whether the fade at its edge appears, is asserted in
 * the geometry suite, where there is layout to measure.
 */
class NoLayoutResizeObserver implements ResizeObserver {
  constructor(_callback: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoLayoutResizeObserver
