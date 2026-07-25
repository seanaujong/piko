import { PANEL_HEIGHT_VH, PANEL_MAX_WIDTH_PX, PANEL_WIDTH_VW, PANEL_Z_INDEX } from '../../shared/constants'

// `:host { all: initial }` resets inherited CSS properties (color, font-family, custom
// properties/--vars) before they cross into our shadow tree — shadow DOM isolates
// selector-based cascade, but inheritance still crosses the boundary without this.
//
// :host spans the full viewport, always present in the render tree (never display:none) —
// only opacity/pointer-events toggle per data-hidden, on :host's two children rather than on
// :host itself. That's deliberate: display:none + @starting-style/allow-discrete turned out
// unreliable in practice (the entrance transition would sometimes just snap instead of
// playing), where plain opacity/transform transitions on already-rendered elements always
// animate correctly. :host itself is click-through (pointer-events: none); only
// .lockin-backdrop and .lockin-panel re-enable it, and only while visible.
export const PANEL_STYLES = `
:host {
  all: initial;
  position: fixed;
  inset: 0;
  z-index: ${PANEL_Z_INDEX};
  display: block;
  pointer-events: none;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  color: #1a1a1a;
}

.lockin-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.28);
  pointer-events: auto;
  opacity: 1;
  transition:
    opacity 180ms ease,
    background-color 200ms ease;
}

/* Darkens further while the pointer is anywhere over the preview (backdrop or panel) — a
   deliberate touch, not just a static scrim. :host's own condition must go inside the
   functional-notation parens — :host:hover (bare-chained) silently never matches, while
   :host(:hover) does; confirmed live, this isn't a stylistic preference. */
:host(:hover) .lockin-backdrop {
  background: rgba(0, 0, 0, 0.72);
}

:host([data-hidden]) .lockin-backdrop {
  opacity: 0;
  pointer-events: none;
}

.lockin-panel {
  position: absolute;
  top: 50%;
  left: 50%;
  width: ${PANEL_WIDTH_VW}vw;
  max-width: ${PANEL_MAX_WIDTH_PX}px;
  height: ${PANEL_HEIGHT_VH}vh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  transform-origin: center;
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

:host([data-hidden]) .lockin-panel {
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -50%) scale(0.85);
}

.lockin-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: #f7f7f8;
  flex: 0 0 auto;
}

.lockin-url {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: #555;
}

.lockin-button {
  all: initial;
  box-sizing: border-box;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  padding: 4px 10px;
  border-radius: 6px;
  background: #eee;
  color: #333;
  text-align: center;
}

.lockin-button:hover {
  background: #e2e2e2;
}

.lockin-button.active {
  background: #4a3fe0;
  color: white;
}

.lockin-close {
  padding: 4px 8px;
  background: #e53935;
  color: #1a1a1a;
  font-weight: 600;
}

.lockin-close:hover {
  background: #c62828;
}

/*
 * .lockin-body is the v2 seam: a single flex row with one child pane today. A future
 * Claude-driven pane (Native Messaging) can be added as a sibling flex child here without
 * restructuring the container.
 */
.lockin-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.lockin-content {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  background: #ffffff;
}

.lockin-framed-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.lockin-iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  opacity: 0;
  transition: opacity 200ms ease;
}

.lockin-framed-wrapper.lockin-framed-loaded .lockin-iframe {
  opacity: 1;
}

.lockin-spinner {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  opacity: 1;
  transition: opacity 200ms ease;
  pointer-events: none;
}

.lockin-spinner::after {
  content: '';
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid rgba(0, 0, 0, 0.1);
  border-top-color: #4a3fe0;
  animation: lockin-spin 700ms linear infinite;
}

.lockin-framed-wrapper.lockin-framed-loaded .lockin-spinner {
  opacity: 0;
}

@keyframes lockin-spin {
  to {
    transform: rotate(360deg);
  }
}

.lockin-loading,
.lockin-error {
  padding: 32px;
  color: #555;
  line-height: 1.5;
}

.lockin-article {
  position: relative; /* containing block for the highlight overlay */
  max-width: 680px;
  margin: 0 auto;
  padding: 32px;
  line-height: 1.65;
  font-size: 16px;
}

/*
 * Sentence highlights are painted here rather than by wrapping text in elements: a sentence
 * routinely spans several inline nodes, so wrapping would mean re-parenting the sanitized
 * DOM that extract.ts produced. The overlay sits beneath the text, so every article child
 * needs its own stacking context to stay legible on top of a mark.
 */
.lockin-marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.lockin-article > *:not(.lockin-marks) {
  position: relative;
  z-index: 1;
}

.lockin-mark {
  position: absolute;
  border-radius: 2px;
}

.lockin-mark-hover {
  background: rgba(74, 63, 224, 0.1);
}

.lockin-mark-clip {
  background: rgba(246, 205, 78, 0.42);
}

.lockin-article h1 {
  font-size: 26px;
  line-height: 1.3;
  margin: 0 0 6px;
}

.lockin-byline {
  color: #666;
  font-size: 13px;
  margin-bottom: 20px;
}

.lockin-article img {
  max-width: 100%;
  height: auto;
}

/* ---- clippings journal: .lockin-body's second flex child ---- */

.lockin-clips {
  flex: 0 0 300px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  background: #fcfcfb;
}

.lockin-clips[data-hidden] {
  display: none;
}

.lockin-clips-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 11px 13px 9px;
  flex: 0 0 auto;
}

.lockin-clips-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #555;
}

.lockin-clips-count {
  font-size: 11px;
  color: #8a8a80;
  font-variant-numeric: tabular-nums;
}

.lockin-clips-copy {
  margin-left: auto;
  font-size: 12px;
  padding: 3px 9px;
}

.lockin-clips-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 13px 9px;
  flex: 0 0 auto;
}

.lockin-chip {
  all: initial;
  box-sizing: border-box;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  color: #666;
}

.lockin-chip:hover {
  border-color: #4a3fe0;
  color: #1a1a1a;
}

.lockin-chip[aria-pressed='true'] {
  background: #f6cd4e;
  border-color: transparent;
  color: #1a1a1a;
  font-weight: 600;
}

.lockin-chip-reset {
  border-style: dashed;
}

.lockin-chip-count {
  font-size: 10px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.lockin-clips-list {
  flex: 1 1 auto;
  overflow: auto;
  padding: 0 13px 14px;
}

.lockin-clips-empty {
  font-size: 12.5px;
  line-height: 1.5;
  color: #8a8a80;
  font-style: italic;
  margin: 4px 0 0;
}

/* Session boundaries render inline so temporal structure shows without the list
   ever changing shape — no separate grouping mode to switch into. */
.lockin-clips-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 11px 0 8px;
  font-size: 10px;
  color: #9a9a94;
  letter-spacing: 0.04em;
}

.lockin-clips-divider::before,
.lockin-clips-divider::after {
  content: '';
  height: 1px;
  background: rgba(0, 0, 0, 0.09);
  flex: 1 1 auto;
}

.lockin-clip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 8px;
  margin-bottom: 5px;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.07);
  background: #ffffff;
}

.lockin-clip-when {
  flex: 0 0 auto;
  font-size: 10px;
  color: #9a9a94;
  padding-top: 2px;
  font-variant-numeric: tabular-nums;
}

.lockin-clip-body {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: #2b2b2b;
}

.lockin-clip-source {
  display: block;
  margin-top: 3px;
  font-size: 10px;
  color: #9a9a94;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lockin-clip-remove {
  all: initial;
  box-sizing: border-box;
  cursor: pointer;
  flex: 0 0 auto;
  font-family: inherit;
  font-size: 11px;
  color: #b0b0a8;
  padding: 2px 4px;
  opacity: 0;
  transition: opacity 120ms ease;
}

.lockin-clip:hover .lockin-clip-remove,
.lockin-clip-remove:focus-visible {
  opacity: 1;
}

.lockin-clip-remove:hover {
  color: #e53935;
}
`
