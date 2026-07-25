import { Readability } from '@mozilla/readability'
import { sanitizeArticleHtml } from './sanitize'

export type ExtractedArticle = {
  title: string
  contentHtml: string
  textContent: string
  byline?: string
}

/**
 * Pure given its inputs: same (html, finalUrl) always yields the same article.
 * A DOMParser document's baseURI is "about:blank", so without the injected <base>,
 * Readability resolves every relative image/link src against about:blank and silently
 * breaks them — the <base> must be inserted before Readability runs.
 */
export function extractArticle(html: string, finalUrl: string): ExtractedArticle | null {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const base = doc.createElement('base')
    base.setAttribute('href', finalUrl)
    doc.head.insertBefore(base, doc.head.firstChild)

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
