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

/* Two groups at opposite ends: what the preview is on the left, what to do with it on the
   right. The split is structural rather than an auto margin on one child, so no later rule
   can quietly undo it — see the note on piko-header-source. */
.piko-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: #f7f7f8;
  flex: 0 0 auto;
}

/* The address and the button that acts on it. Only this group shrinks — a long URL gives up
   width to its own ellipsis rather than crowding the controls.

   The gap here is far smaller than the one between the header's two groups, because both
   children already carry their own inner padding: the address pill extends 5px past its text
   and the icon button centres a 13px glyph in a 22px box. A gap sized to look right between
   bare edges reads as a hole between these two. */
.piko-header-source {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 0 1 auto;
  min-width: 0;
}

/* Reader/Live page and close. Never shrinks: these are fixed-size controls, and an ellipsis
   through a button label is not a legible fallback. */
.piko-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
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
 * The journal docked beside the page, for clipping the page itself.
 *
 * Deliberately NOT the modal panel: that has a backdrop, and you cannot clip a page you have
 * covered. The rail takes back its own width and nothing else, so the page underneath stays
 * readable and clickable — which is the whole point of the mode it accompanies.
 *
 * Flush to the edges, because the page yields this width rather than being covered by it. A
 * floating card — inset, rounded, drop-shadowed — reads as something laid over the page, and
 * leaves a strip of page background around itself that belongs to neither. What it is is a
 * second column, so it is drawn as one: one border where it meets the page, and no gap.
 */
.piko-rail {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 320px;
  max-width: 40vw;
  box-sizing: border-box;
  display: flex;
  pointer-events: auto;
  background: #ffffff;
  border-left: 1px solid rgba(0, 0, 0, 0.12);
  box-shadow: -2px 0 16px rgba(0, 0, 0, 0.08);
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

/* The same two-group arrangement as the panel header: what this is, then what to do with it. */
.piko-clips-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 11px 13px 5px;
  flex: 0 0 auto;
}

/* Baseline within the group, so the count sits on the title's line rather than on its box. */
.piko-clips-heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

/* Both children are icon buttons carrying their own padding — see piko-header-source. */
.piko-clips-actions {
  display: flex;
  align-items: center;
  gap: 2px;
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


/* Sits between the header and the chips, present only while a search is running. The magnifier
   inside it repeats the icon that opened it, so the field is legible as what that button did. */
.piko-clips-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 13px 6px;
  padding: 3px 8px;
  border-radius: 7px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  color: #a8a8a0;
  flex: 0 0 auto;
}

.piko-clips-search-field {
  all: initial;
  box-sizing: border-box;
  flex: 1 1 auto;
  min-width: 0;
  font-family: inherit;
  font-size: 12.5px;
  color: #1a1a1a;
}

.piko-clips-search-field::placeholder {
  color: #a8a8a0;
}

.piko-clips-search:focus-within {
  border-color: #4a3fe0;
}

/* Reads as engaged while the field below it is open, the same way the mode toggle does. */
.piko-clips-find.is-on {
  color: #4a3fe0;
}

/* The row, and the reset that must not scroll away with it: a filter you cannot see is a
   trap, and so is the only control that clears one. */
.piko-clips-filters {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 0 13px 4px;
  flex: 0 0 auto;
}

/**
 * Two rows at most, scrolling sideways past them.
 *
 * Wrapping was unbounded — thirty sources after a research week made the filter row taller
 * than the list it filters. Capping the height and moving the overflow onto a scroll axis
 * bounds it for any number of sources without introducing a collapsed state to forget you are
 * in. It costs nothing at small counts, where the row is one line as before.
 *
 * The axis carries meaning, which is why it is horizontal rather than a "show more": chips are
 * ordered by the sitting they were last used in, so scrolling right is moving back through the
 * reading. It reduces the height, not the scanning — finding one source among thirty is what
 * search is for.
 *
 * Column flow rather than wrapping is what produces horizontal overflow at all: flex wrapping
 * resolves overflow by adding rows, which is the thing being fixed.
 */
.piko-clips-chips {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  grid-template-rows: auto;
  gap: 4px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.18) transparent;
  /* A lane for the scrollbar to draw in. macOS overlay scrollbars take no layout space, so
     without this the bar is painted straight across the bottom row of chips. */
  padding-bottom: 9px;
}

.piko-clips-chips[data-rows='2'] {
  grid-template-rows: auto auto;
}

/**
 * Where one span of time gives way to the next, reading rightwards into the past.
 *
 * Set vertically because the row is two chips tall and only a few characters wide per column —
 * a horizontal label would cost more scroll width than the chips it introduces, in the one
 * dimension that is already scarce.
 */
.piko-chip-band {
  all: initial;
  box-sizing: border-box;
  cursor: pointer;
  font-family: inherit;
  grid-row: 1 / -1;
  align-self: stretch;
  display: flex;
  align-items: center;
  writing-mode: vertical-rl;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a8a8a0;
  white-space: nowrap;
  border-left: 1px solid rgba(0, 0, 0, 0.11);
  padding-left: 5px;
  margin-left: 3px;
  transition: color 120ms ease, border-color 120ms ease;
}

/* Nothing precedes the leading marker, so a rule there would read as a stray line against the
   edge rather than as a division between two spans. */
.piko-chip-band:first-child {
  border-left: none;
  padding-left: 0;
  margin-left: 0;
}

.piko-chip-band:hover {
  color: #4a4a45;
}

.piko-chip-band:focus-visible {
  outline: 2px solid #6c5ce7;
  outline-offset: 1px;
}

.piko-chip-band[aria-pressed='true'] {
  color: #4a3fe0;
  border-left-color: #4a3fe0;
  font-weight: 600;
}

/* The only resting sign that the row continues: macOS overlay scrollbars show while scrolling
   and then vanish, so without this the chips past the edge are simply invisible. Applied from
   a measurement rather than from the chip count, because fading an edge with nothing behind it
   promises content that isn't there. */
.piko-clips-chips[data-overflowing] {
  mask-image: linear-gradient(to right, #000 calc(100% - 22px), transparent);
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

/* Sits on the header row beside the count. Centred rather than baseline-aligned with the
   title, and never wrapped: at two words, a break turns it into a two-line block that pushes
   the row taller than everything beside it. */
.piko-chip-reset {
  border-style: dashed;
  align-self: center;
  white-space: nowrap;
  flex: 0 0 auto;
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
/* Enough air to read as a break in the stream, not enough to read as the end of the list.
   Cards are 5px apart, so the space either side of the rule is set against that rather than
   against nothing. */
.piko-clips-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 3px 0 5px;
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

/* Both after .piko-icon-button:hover — equal specificity, so source order decides. */
.piko-clip-remove:hover,
.piko-clips-close:hover {
  color: #e53935;
}
`
