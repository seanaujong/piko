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
// .piko-backdrop and .piko-panel re-enable it, and only while visible.
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

/* Gated on data-preview, not on the host being visible: the docked rail also makes the host
   visible, and a scrim over the page would defeat the mode the rail accompanies. */
.piko-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.28);
  pointer-events: none;
  opacity: 0;
  transition:
    opacity 180ms ease,
    background-color 200ms ease;
}

:host([data-preview]) .piko-backdrop {
  opacity: 1;
  pointer-events: auto;
}

/* Darkens further while the pointer is anywhere over the preview (backdrop or panel) — a
   deliberate touch, not just a static scrim. :host's own condition must go inside the
   functional-notation parens — :host:hover (bare-chained) silently never matches, while
   :host(:hover) does; confirmed live, this isn't a stylistic preference. */
:host([data-preview]:hover) .piko-backdrop {
  background: rgba(0, 0, 0, 0.72);
}

.piko-panel {
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
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -50%) scale(0.85);
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

:host([data-preview]) .piko-panel {
  opacity: 1;
  pointer-events: auto;
  transform: translate(-50%, -50%) scale(1);
}

.piko-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: #f7f7f8;
  flex: 0 0 auto;
}

/* The URL doubles as the copy-link control, so it needs a button's affordances — keyboard
   focus, a hover tint — while still reading as plain text at rest. */
.piko-url {
  all: initial;
  box-sizing: border-box;
  display: block;
  /* Sized to its text, not to the header: a click target should be as wide as the thing it
     looks like. */
  flex: 0 1 auto;
  min-width: 0;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  color: #555;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 5px;
  margin-left: -5px;
  border-radius: 5px;
  transition: background-color 120ms ease, color 120ms ease;
}

/* Travels with the URL rather than with the panel controls, because it acts on the URL. The
   auto margin sits after it, so Reader and close stay pinned to the far right. */
.piko-url-open {
  margin-right: auto;
}

.piko-url:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #1a1a1a;
}

.piko-url:focus-visible {
  outline: 2px solid #6c5ce7;
  outline-offset: 1px;
}

.piko-url.is-done {
  color: #2e9e5b;
}

.piko-url.is-failed {
  color: #e53935;
}

.piko-button {
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

.piko-button:hover {
  background: #e2e2e2;
}

.piko-button.active {
  background: #4a3fe0;
  color: white;
}

.piko-close {
  padding: 4px 8px;
  background: #e53935;
  color: #1a1a1a;
  font-weight: 600;
}

.piko-close:hover {
  background: #c62828;
}

/**
 * The journal docked over the page, for clipping the page itself.
 *
 * Deliberately NOT the modal panel: that has a backdrop, and you cannot clip a page you have
 * covered. The rail takes back its own width and nothing else, so the page underneath stays
 * readable and clickable — which is the whole point of the mode it accompanies.
 */
.piko-rail {
  position: absolute;
  top: 12px;
  right: 12px;
  bottom: 12px;
  width: 320px;
  max-width: 40vw;
  box-sizing: border-box;
  display: flex;
  pointer-events: auto;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  opacity: 1;
  transform: translateX(0);
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.piko-rail[data-hidden] {
  opacity: 0;
  pointer-events: none;
  transform: translateX(16px);
}

/* Marks for the host page go here: absolutely positioned over the whole viewport so rects
   measured against it are viewport coordinates, and click-through so the page still works. */
.piko-host-surface {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/*
 * .piko-body is the v2 seam: a single flex row with one child pane today. A future
 * Claude-driven pane (Native Messaging) can be added as a sibling flex child here without
 * restructuring the container. The clippings pane moves between here and .piko-rail
 * depending on whether there is a preview to sit inside.
 */
.piko-body {
  flex: 1 1 auto;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.piko-content {
  flex: 1 1 auto;
  min-width: 0;
  overflow: auto;
  background: #ffffff;
}

.piko-framed-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
}

.piko-iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  opacity: 0;
  transition: opacity 200ms ease;
}

.piko-framed-wrapper.piko-framed-loaded .piko-iframe {
  opacity: 1;
}

.piko-spinner {
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

.piko-spinner::after {
  content: '';
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid rgba(0, 0, 0, 0.1);
  border-top-color: #4a3fe0;
  animation: piko-spin 700ms linear infinite;
}

.piko-framed-wrapper.piko-framed-loaded .piko-spinner {
  opacity: 0;
}

@keyframes piko-spin {
  to {
    transform: rotate(360deg);
  }
}

.piko-loading,
.piko-error {
  padding: 32px;
  color: #555;
  line-height: 1.5;
}

.piko-article {
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
.piko-marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.piko-article > *:not(.piko-marks) {
  position: relative;
  z-index: 1;
}

.piko-mark {
  position: absolute;
  border-radius: 2px;
}

.piko-mark-hover {
  background: rgba(74, 63, 224, 0.1);
}

.piko-mark-clip {
  background: rgba(246, 205, 78, 0.42);
}

.piko-article h1 {
  font-size: 26px;
  line-height: 1.3;
  margin: 0 0 6px;
}

.piko-byline {
  color: #666;
  font-size: 13px;
  margin-bottom: 20px;
}

.piko-article img {
  max-width: 100%;
  height: auto;
}

/* ---- clippings journal: .piko-body's second flex child ---- */

.piko-clips {
  flex: 0 0 300px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid rgba(0, 0, 0, 0.08);
  background: #fcfcfb;
}

.piko-clips[data-hidden] {
  display: none;
}

.piko-clips-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 11px 13px 9px;
  flex: 0 0 auto;
}

.piko-clips-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #555;
}

.piko-clips-count {
  font-size: 11px;
  color: #8a8a80;
  font-variant-numeric: tabular-nums;
}

.piko-clips-copy {
  margin-left: auto;
  font-size: 12px;
  padding: 3px 9px;
}

.piko-clips-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 13px 9px;
  flex: 0 0 auto;
}

.piko-chip {
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

.piko-chip:hover {
  border-color: #4a3fe0;
  color: #1a1a1a;
}

.piko-chip[aria-pressed='true'] {
  background: #f6cd4e;
  border-color: transparent;
  color: #1a1a1a;
  font-weight: 600;
}

.piko-chip-reset {
  border-style: dashed;
}

.piko-chip-count {
  font-size: 10px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.piko-clips-list {
  flex: 1 1 auto;
  overflow: auto;
  padding: 0 13px 14px;
}

.piko-clips-empty {
  font-size: 12.5px;
  line-height: 1.5;
  color: #8a8a80;
  font-style: italic;
  margin: 4px 0 0;
}

/* Session boundaries render inline so temporal structure shows without the list
   ever changing shape — no separate grouping mode to switch into. */
.piko-clips-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 11px 0 8px;
  font-size: 10px;
  color: #9a9a94;
  letter-spacing: 0.04em;
}

.piko-clips-divider::before,
.piko-clips-divider::after {
  content: '';
  height: 1px;
  background: rgba(0, 0, 0, 0.09);
  flex: 1 1 auto;
}

.piko-clip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 8px 7px;
  margin-bottom: 5px;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.07);
  background: #ffffff;
}

.piko-clip-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  /* Pulls the 22px buttons back toward the card edge so the row reads as metadata
     rather than as a band of its own. */
  margin-right: -3px;
  min-height: 22px;
}

.piko-clip-when {
  flex: 0 0 auto;
  font-size: 10px;
  color: #9a9a94;
  font-variant-numeric: tabular-nums;
}

.piko-clip-body {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: #2b2b2b;
}

/* A real anchor, so cmd-click and middle-click open a tab the way the reader expects and
   the target is visible in the status bar before committing to it. */
.piko-clip-source {
  all: initial;
  box-sizing: border-box;
  display: block;
  margin-top: 3px;
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  color: #9a9a94;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 120ms ease;
}

.piko-clip-source:hover {
  color: #4a3fe0;
  text-decoration: underline;
}

.piko-clip-source:focus-visible {
  outline: 2px solid #6c5ce7;
  outline-offset: 1px;
}

/* Hidden buttons still occupy layout — opacity doesn't remove them from flow — so beside
   the text they would reserve ~70px of a narrow pane's width permanently. In the meta row
   they cost nothing horizontally, because the row's other occupant is a short timestamp. */
.piko-clip-actions {
  flex: 0 0 auto;
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms ease;
}

/* Revealed on hover to keep the list quiet, but focus-within keeps them reachable by
   keyboard, where there is no hover to trigger. */
.piko-clip:hover .piko-clip-actions,
.piko-clip-actions:focus-within {
  opacity: 1;
}

.piko-icon-button {
  all: initial;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  cursor: pointer;
  color: #b0b0a8;
  transition: background-color 120ms ease, color 120ms ease;
}

.piko-icon-button:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #4a4a45;
}

.piko-icon-button:focus-visible {
  outline: 2px solid #6c5ce7;
  outline-offset: 1px;
}

.piko-icon-button.is-done {
  color: #2e9e5b;
}

.piko-icon-button.is-failed {
  color: #e53935;
}

/* After .piko-icon-button:hover — equal specificity, so source order decides. */
.piko-clip-remove:hover {
  color: #e53935;
}
`
