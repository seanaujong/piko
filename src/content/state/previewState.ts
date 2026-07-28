/**
 * What the preview shows, as a pure fold over events.
 *
 * Every rule about what the reader sees lives in `transition` and nowhere else. Events are
 * mechanical — each one reports that something happened, and none of them decides what it
 * means. The content script that folds them holds no policy of its own: it dispatches, renders
 * the result, and is free of any question about reader-vs-framed or which failure falls back to
 * what. A rule-shaped `if` growing outside this file is the signal that a decision has escaped
 * the layer that owns it.
 *
 * `PreviewState` and `PreviewEvent` are discriminated unions and the `switch` below is
 * exhaustive over `PreviewEvent`, so adding a variant without handling it fails the typecheck
 * rather than falling through at runtime. Keep it that way: a `default:` case would make the
 * compiler stop asking, and turn the next added event into a silent no-op.
 */
import { extractArticle, type ExtractedArticle } from '../extraction/extract'

export type LinkTarget = { url: string; anchorText?: string }

export type Content = { mode: 'framed' } | { mode: 'extracted'; article: ExtractedArticle }

export type PreviewState =
  | { kind: 'idle' }
  | { kind: 'loading'; target: LinkTarget }
  | { kind: 'ready'; target: LinkTarget; finalUrl: string; html: string | null; content: Content }
  | { kind: 'error'; target: LinkTarget; reason: string }

export type Dispatch = (event: PreviewEvent) => void

export type PreviewEvent =
  /** A preview was asked for. Named for what happened, not for the drag that currently causes it. */
  | { type: 'PreviewRequested'; target: LinkTarget }
  | { type: 'FrameCheckOk'; finalUrl: string; html: string | null }
  | { type: 'FrameCheckBlocked'; finalUrl: string; html: string }
  | { type: 'FrameCheckFailed'; reason: string }
  | { type: 'UnsupportedContent'; contentType: string }
  | { type: 'IframeTimedOut' }
  | { type: 'ManualModeToggled' }
  | { type: 'Dismissed' }

/**
 * Extraction (DOMParser + Readability + DOMPurify) is synchronous, local computation over
 * already-fetched HTML — no network involved — so it's inlined directly into the reducer
 * rather than routed through its own async event round-trip. This is also what lets
 * ManualModeToggled flip framed <-> extracted without ever refetching: `html` and `finalUrl`
 * are retained on the 'ready' state regardless of which mode is currently displayed.
 */
export function transition(state: PreviewState, event: PreviewEvent): PreviewState {
  switch (event.type) {
    case 'PreviewRequested':
      return { kind: 'loading', target: event.target }

    case 'Dismissed':
      return { kind: 'idle' }

    /**
     * Reader first, even when the page is frameable.
     *
     * Sentence highlighting and clipping only exist over extracted content — a framed page is
     * a cross-origin iframe whose DOM can't be read — so defaulting to the frame left the
     * whole feature behind a toggle. Framing is now the fallback for pages Readability can't
     * make sense of, which also sidesteps its quieter failure modes (a host's frame-src CSP
     * blocking the iframe with no JS-visible signal).
     */
    case 'FrameCheckOk': {
      if (state.kind !== 'loading') return state

      if (event.html !== null) {
        const article = extractArticle(event.html, event.finalUrl)
        if (article) {
          return {
            kind: 'ready',
            target: state.target,
            finalUrl: event.finalUrl,
            html: event.html,
            content: { mode: 'extracted', article },
          }
        }
      }

      return {
        kind: 'ready',
        target: state.target,
        finalUrl: event.finalUrl,
        html: event.html,
        content: { mode: 'framed' },
      }
    }

    case 'FrameCheckBlocked':
      if (state.kind !== 'loading') return state
      return readyFromExtraction(state.target, event.finalUrl, event.html)

    case 'FrameCheckFailed':
      if (state.kind !== 'loading') return state
      return { kind: 'error', target: state.target, reason: event.reason }

    /**
     * Said as a fact about the file and an offer, because the reader is holding a link that
     * still works. The type is named — "a .zip" is a different thing to be told than "no" — and
     * the way out is the header's own new-tab button, which is on screen as this is read.
     */
    case 'UnsupportedContent':
      if (state.kind !== 'loading') return state
      return {
        kind: 'error',
        target: state.target,
        reason: `Piko can't preview this (${event.contentType || 'unknown content type'}). Open it in a new tab instead.`,
      }

    /**
     * With a body, the timeout is a fall back to reader mode. Without one there is nowhere to
     * fall back to, and what is left to say is what actually happened.
     *
     * The old wording here offered reader mode's absence as the explanation, which was the one
     * thing the reader had not asked for: a dragged PDF has no reader mode by nature, so being
     * told it can't be shown in one describes the frame's own design rather than the failure.
     * What remains at this point is a frame that never loaded — a host page's `frame-src` policy
     * refusing it, or a load that stalled — and in both the link itself still opens.
     */
    case 'IframeTimedOut': {
      if (state.kind !== 'ready' || state.content.mode !== 'framed') return state
      if (state.html === null) {
        return {
          kind: 'error',
          target: state.target,
          reason: "This didn't finish loading in the preview. Open it in a new tab to see it.",
        }
      }
      return readyFromExtraction(state.target, state.finalUrl, state.html)
    }

    case 'ManualModeToggled': {
      if (state.kind !== 'ready') return state
      if (state.content.mode === 'extracted') {
        return { ...state, content: { mode: 'framed' } }
      }
      if (state.html === null) return state // nothing to extract from (e.g. a PDF) — toggle is a no-op
      return readyFromExtraction(state.target, state.finalUrl, state.html)
    }
  }
}

function readyFromExtraction(target: LinkTarget, finalUrl: string, html: string): PreviewState {
  const article = extractArticle(html, finalUrl)
  if (!article) {
    return { kind: 'error', target, reason: "Couldn't extract readable content from this page." }
  }
  return { kind: 'ready', target, finalUrl, html, content: { mode: 'extracted', article } }
}
