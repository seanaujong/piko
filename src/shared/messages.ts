export type CheckFrameabilityRequest = {
  type: 'CHECK_FRAMEABILITY'
  targetUrl: string
  /** window.location.origin of the tab doing the dragging — frame-ancestors/XFO must be evaluated against this, not the extension's own origin. */
  pageOrigin: string
}

export type CheckFrameabilityResponse =
  // `html` is included even when framing is allowed, not just when it's blocked: it's what
  // lets a later IframeTimedOut or a manual toggle-to-reader fall back to extraction without
  // a second network round-trip. Non-HTML targets (e.g. a PDF) carry `html: null` — there's
  // nothing for Readability to parse, so those can only ever stay framed or show an error.
  | { type: 'FRAME_OK'; finalUrl: string; html: string | null }
  // Blocked for any reason the worker can see, which is deliberately wider than the frame
  // headers it started as: `Content-Security-Policy`, `X-Frame-Options`, and a server declaring
  // its own response an attachment all reduce to the same instruction — here is the body, do
  // not navigate to it. Widening the existing answer rather than adding a state is what keeps
  // the reducer free of the question, since what it does about it is identical either way.
  | { type: 'FRAME_BLOCKED'; html: string; finalUrl: string }
  // Nothing to read and nothing safe to show: a type Chrome would save rather than render.
  // `previewableContent.ts` holds the list and the reason it is an allow-list.
  | { type: 'UNSUPPORTED_CONTENT'; finalUrl: string; contentType: string }
  | { type: 'FETCH_ERROR'; reason: string }

export type ExtensionRequest = CheckFrameabilityRequest
export type ExtensionResponse = CheckFrameabilityResponse

/**
 * Background → content script. The toolbar action has no page of its own, so its click has to
 * be relayed into the tab that will act on it. Separate from ExtensionRequest because the
 * direction is reversed: the content script listens, the worker sends.
 */
export type ToggleClippingRequest = { type: 'TOGGLE_CLIPPING' }

/**
 * Sent to a tab the reader has just excluded. A content script cannot be unloaded once injected,
 * so keeping it out of the *next* load — which is all `excludeMatches` can do — would leave Piko
 * live on the page where the reader just said "not here", until they happened to reload it.
 * This is the half of "not here" that can be delivered immediately.
 */
export type StandDownRequest = { type: 'STAND_DOWN' }

export type TabRequest = ToggleClippingRequest | StandDownRequest
