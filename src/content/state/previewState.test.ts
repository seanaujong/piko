import { describe, expect, it } from 'vitest'
import type { LinkTarget, PreviewState } from './previewState'
import { transition } from './previewState'

const TARGET: LinkTarget = { url: 'https://example.com/article', anchorText: 'an article' }
const FINAL = 'https://example.com/article'

/** Long enough that Readability judges it an article rather than boilerplate. */
const ARTICLE_HTML = `<!doctype html><html><head><title>An Article</title></head><body>
  <article>
    <h1>An Article</h1>
    ${Array.from(
      { length: 8 },
      () =>
        '<p>This is a paragraph of genuine prose with enough words in it that the extractor treats the surrounding element as the real body of the document rather than as navigation chrome.</p>',
    ).join('')}
  </article></body></html>`

/**
 * Parses fine and yields nothing. Measured, not assumed: Readability is lenient enough to
 * return an article from a page containing only a nav link, so "unextractable" in practice
 * means a document with no content at all.
 */
const EMPTY_HTML = '<!doctype html><html><head><title>T</title></head><body></body></html>'

const loading = (): PreviewState => ({ kind: 'loading', target: TARGET })

/** Each helper is a state the reducer actually produces, reached the way the app reaches it. */
const extracted = (): PreviewState =>
  transition(loading(), { type: 'FrameCheckOk', finalUrl: FINAL, html: ARTICLE_HTML })

/** Framed while still holding extractable html — only reachable by toggling out of reader. */
const framedByToggle = (): PreviewState =>
  transition(extracted(), { type: 'ManualModeToggled' })

/** Framed with nothing to fall back on, as a PDF would be. */
const framedWithoutHtml = (): PreviewState =>
  transition(loading(), { type: 'FrameCheckOk', finalUrl: FINAL, html: null })

describe('transition', () => {
  it('starts a preview from idle', () => {
    const state = transition({ kind: 'idle' }, { type: 'PreviewRequested', target: TARGET })

    expect(state).toEqual({ kind: 'loading', target: TARGET })
  })

  it('returns to idle when dismissed, from any state', () => {
    expect(transition(loading(), { type: 'Dismissed' })).toEqual({ kind: 'idle' })
    expect(transition(extracted(), { type: 'Dismissed' })).toEqual({ kind: 'idle' })
  })

  describe('reader first, framing as the fallback', () => {
    it('extracts a frameable page rather than framing it', () => {
      // The reversal that makes the v2 feature visible at all: highlighting only works over
      // extracted content, so defaulting to the frame hid it behind a toggle.
      const state = transition(loading(), {
        type: 'FrameCheckOk',
        finalUrl: FINAL,
        html: ARTICLE_HTML,
      })

      expect(state.kind).toBe('ready')
      expect(state.kind === 'ready' && state.content.mode).toBe('extracted')
    })

    it('frames a page with nothing to extract', () => {
      const state = transition(loading(), {
        type: 'FrameCheckOk',
        finalUrl: FINAL,
        html: EMPTY_HTML,
      })

      expect(state.kind === 'ready' && state.content.mode).toBe('framed')
    })

    it('frames a page with no html at all, such as a PDF', () => {
      const state = transition(loading(), { type: 'FrameCheckOk', finalUrl: FINAL, html: null })

      expect(state.kind === 'ready' && state.content.mode).toBe('framed')
    })
  })

  describe('failure paths', () => {
    it('extracts a page that refuses to be framed', () => {
      const state = transition(loading(), {
        type: 'FrameCheckBlocked',
        finalUrl: FINAL,
        html: ARTICLE_HTML,
      })

      expect(state.kind === 'ready' && state.content.mode).toBe('extracted')
    })

    it('errors when a page can neither be framed nor extracted', () => {
      const state = transition(loading(), {
        type: 'FrameCheckBlocked',
        finalUrl: FINAL,
        html: EMPTY_HTML,
      })

      expect(state.kind).toBe('error')
    })

    it('errors on a failed check, carrying the reason through', () => {
      const state = transition(loading(), { type: 'FrameCheckFailed', reason: 'network is down' })

      expect(state).toMatchObject({ kind: 'error', reason: 'network is down' })
    })

    it('names the content type when the target is not a page', () => {
      const state = transition(loading(), {
        type: 'UnsupportedContent',
        contentType: 'application/zip',
      })

      expect(state.kind === 'error' && state.reason).toContain('application/zip')
    })

    /** A refusal is only half an answer while the reader is holding a link that still works. */
    it('points at the link the reader still has', () => {
      const state = transition(loading(), {
        type: 'UnsupportedContent',
        contentType: 'application/zip',
      })

      expect(state.kind === 'error' && state.reason).toContain('new tab')
    })
  })

  describe('iframe timeout', () => {
    it('falls back to reader mode when the frame never loads', () => {
      const state = transition(framedByToggle(), { type: 'IframeTimedOut' })

      expect(state.kind === 'ready' && state.content.mode).toBe('extracted')
    })

    it('errors when there is nothing to fall back to', () => {
      const state = transition(framedWithoutHtml(), { type: 'IframeTimedOut' })

      expect(state.kind).toBe('error')
    })

    /**
     * A PDF has no reader mode by nature, so offering its absence as the explanation described
     * the design rather than the failure. What went wrong is that the frame never loaded.
     */
    it('says what failed, not which mode is unavailable', () => {
      const state = transition(framedWithoutHtml(), { type: 'IframeTimedOut' })
      const reason = state.kind === 'error' ? state.reason : ''

      expect(reason).toContain('new tab')
      expect(reason).not.toContain('reader mode')
    })

    it('is ignored once the reader is already showing', () => {
      const showing = extracted()

      expect(transition(showing, { type: 'IframeTimedOut' })).toBe(showing)
    })
  })

  describe('manual toggle', () => {
    it('goes reader to framed and back without refetching', () => {
      const framed = framedByToggle()
      const backAgain = transition(framed, { type: 'ManualModeToggled' })

      expect(framed.kind === 'ready' && framed.content.mode).toBe('framed')
      expect(backAgain.kind === 'ready' && backAgain.content.mode).toBe('extracted')
      // Retaining html on the ready state is what makes the round trip free.
      expect(framed.kind === 'ready' && framed.html).toBe(ARTICLE_HTML)
    })

    it('is a no-op when there is nothing to extract from', () => {
      const framed = framedWithoutHtml()

      expect(transition(framed, { type: 'ManualModeToggled' })).toBe(framed)
    })
  })

  describe('stale events', () => {
    it('ignores a check that resolves after the preview was dismissed', () => {
      // The generation counter in index.ts drops superseded responses, but the reducer
      // refuses them independently — a late reply must never resurrect a closed panel.
      const idle: PreviewState = { kind: 'idle' }

      expect(transition(idle, { type: 'FrameCheckOk', finalUrl: FINAL, html: ARTICLE_HTML })).toBe(
        idle,
      )
      expect(transition(idle, { type: 'FrameCheckFailed', reason: 'too late' })).toBe(idle)
    })

    it('ignores a check that resolves after another preview is already showing', () => {
      const shown = extracted()

      expect(transition(shown, { type: 'FrameCheckOk', finalUrl: FINAL, html: null })).toBe(shown)
    })
  })
})
