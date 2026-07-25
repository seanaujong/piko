/**
 * Whether a page will let itself be framed, answered from the background service worker.
 *
 * The worker is the only place this question *can* be answered. A `fetch()` from page context
 * cannot read `X-Frame-Options` or a `frame-ancestors` directive at all — response headers are
 * withheld from the page's own JavaScript whatever the request's CORS mode, so a content script
 * asking the same question gets a body with no headers attached to it. Folding this into the
 * content script looks like an easy simplification and is not one; the check would compile,
 * run, and quietly report every page as frameable.
 *
 * The fetched html rides back on the answer either way, blocked or not. Reader mode needs that
 * html, and a preview that fell back to it after a refusal would otherwise pay for the same
 * page twice.
 */
import type { CheckFrameabilityResponse } from '../shared/messages'
import { FRAMEABILITY_FETCH_TIMEOUT_MS } from '../shared/constants'

/**
 * frame-ancestors (CSP) wins over X-Frame-Options when both are present (CSP2 precedence).
 * ALLOW-FROM is a dead XFO token no browser honors — treated the same as "no restriction."
 * Matching is against `pageOrigin` (the tab doing the dragging), not the extension's own
 * origin, since the iframe becomes a child frame of the page the user is browsing.
 */
function isBlockedByHeaders(headers: Headers, pageOrigin: string, finalUrl: string): boolean {
  const servingOrigin = new URL(finalUrl).origin
  const csp = headers.get('content-security-policy')
  const frameAncestors = csp && extractDirective(csp, 'frame-ancestors')

  if (frameAncestors) {
    const sources = frameAncestors.split(/\s+/).filter(Boolean)
    if (sources.includes('*')) return false
    if (sources.includes("'none'")) return true
    const allowedOrigins = sources.map((s) => (s === "'self'" ? servingOrigin : s))
    return !allowedOrigins.includes(pageOrigin)
  }

  const xfo = headers.get('x-frame-options')?.trim().toUpperCase()
  if (xfo === 'DENY') return true
  if (xfo === 'SAMEORIGIN') return pageOrigin !== servingOrigin
  return false // no header, or an unrecognized/dead token like ALLOW-FROM
}

function extractDirective(csp: string, name: string): string | null {
  for (const directive of csp.split(';')) {
    const trimmed = directive.trim()
    if (trimmed.toLowerCase().startsWith(name)) {
      return trimmed.slice(name.length).trim()
    }
  }
  return null
}

export async function checkFrameability(
  targetUrl: string,
  pageOrigin: string,
): Promise<CheckFrameabilityResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FRAMEABILITY_FETCH_TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(targetUrl, { redirect: 'follow', signal: controller.signal })
  } catch (err) {
    return { type: 'FETCH_ERROR', reason: err instanceof Error ? err.message : 'Network request failed' }
  } finally {
    clearTimeout(timeout)
  }

  const finalUrl = response.url || targetUrl
  const contentType = response.headers.get('content-type') ?? ''
  const isHtml = contentType.includes('text/html')
  const blocked = isBlockedByHeaders(response.headers, pageOrigin, finalUrl)

  if (!isHtml) {
    if (blocked) return { type: 'UNSUPPORTED_CONTENT', finalUrl, contentType }
    return { type: 'FRAME_OK', finalUrl, html: null }
  }

  const html = await response.text()
  if (blocked) return { type: 'FRAME_BLOCKED', html, finalUrl }
  return { type: 'FRAME_OK', finalUrl, html }
}
