import { Readability } from '@mozilla/readability'
import { sanitizeArticleHtml } from './sanitize'

export type ExtractedArticle = {
  title: string
  contentHtml: string
  textContent: string
  byline?: string
}

/** Attributes holding a single URL. `srcset` holds several and is handled separately. */
const URL_ATTRIBUTES: readonly [string, string][] = [
  ['a[href]', 'href'],
  ['area[href]', 'href'],
  ['img[src]', 'src'],
  ['source[src]', 'src'],
  ['video[src]', 'src'],
  ['audio[src]', 'src'],
  ['video[poster]', 'poster'],
]

function absolute(value: string, finalUrl: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed, finalUrl).href
  } catch {
    return null // an unparseable or exotic scheme — leave whatever was there alone
  }
}

/** `url descriptor, url descriptor` — the descriptor (`2x`, `640w`) must survive untouched. */
function absoluteSrcset(value: string, finalUrl: string): string {
  return value
    .split(',')
    .map((candidate) => {
      const parts = candidate.trim().split(/\s+/)
      const url = parts.shift()
      if (!url) return null
      const resolved = absolute(url, finalUrl)
      return [resolved ?? url, ...parts].join(' ')
    })
    .filter((candidate): candidate is string => candidate !== null)
    .join(', ')
}

/**
 * Rewrites every relative URL in the parsed document to an absolute one, in place.
 *
 * This is the job a `<base href>` used to do here, and the reason it cannot: a `<base>` element
 * is governed by the **host page's** `base-uri` Content Security Policy directive even inside a
 * document that came from `DOMParser`, so on any site serving `base-uri 'self'` — Wikipedia and
 * GitHub among them — the browser blocks the insertion, the document's base stays `about:blank`,
 * and Readability resolves every image and link against that. It fails silently and only on some
 * sites, which is the worst shape a bug can have.
 *
 * Resolving each URL explicitly cannot be vetoed by the page, and says what it means.
 */
export function absolutiseUrls(doc: Document, finalUrl: string): void {
  for (const [selector, attribute] of URL_ATTRIBUTES) {
    for (const element of doc.querySelectorAll(selector)) {
      const resolved = absolute(element.getAttribute(attribute) ?? '', finalUrl)
      if (resolved) element.setAttribute(attribute, resolved)
    }
  }
  for (const element of doc.querySelectorAll('[srcset]')) {
    const srcset = element.getAttribute('srcset')
    if (srcset) element.setAttribute('srcset', absoluteSrcset(srcset, finalUrl))
  }
}

/**
 * Pure given its inputs: same (html, finalUrl) always yields the same article.
 *
 * A DOMParser document's baseURI is "about:blank", so relative URLs have to be resolved before
 * Readability runs or every image and link in the reader silently breaks. `absolutiseUrls` does
 * that without a `<base>` element, for the reason given on it.
 */
export function extractArticle(html: string, finalUrl: string): ExtractedArticle | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    absolutiseUrls(doc, finalUrl)

    const result = new Readability(doc).parse()
    if (!result || !result.content) return null

    return {
      title: result.title ?? 'Untitled',
      contentHtml: sanitizeArticleHtml(result.content),
      textContent: result.textContent ?? '',
      byline: result.byline ?? undefined,
    }
  } catch {
    return null
  }
}
