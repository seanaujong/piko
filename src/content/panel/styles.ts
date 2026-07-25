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
  max-width: 680px;
  margin: 0 auto;
  padding: 32px;
  line-height: 1.65;
  font-size: 16px;
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
`
