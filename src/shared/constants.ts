export const FRAMEABILITY_FETCH_TIMEOUT_MS = 6_000
export const IFRAME_LOAD_TIMEOUT_MS = 2_500

// An article's markup, generously. Well above anything Readability is meant to run on and well
// below what would make the response awkward to pass over the message channel.
export const MAX_FETCHED_HTML_BYTES = 8_000_000

// Above anything a host page could plausibly stack (max signed 32-bit int).
export const PANEL_Z_INDEX = 2_147_483_647

// A centered floating card sized as a fraction of the viewport, not edge-to-edge — the
// surrounding backdrop is part of the look, not empty margin. max-width keeps it from
// becoming absurdly wide on ultra-wide monitors.
export const PANEL_WIDTH_VW = 80
export const PANEL_HEIGHT_VH = 80
export const PANEL_MAX_WIDTH_PX = 1400
