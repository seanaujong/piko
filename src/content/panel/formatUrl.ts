/**
 * How a source is named on screen: its address, and its title.
 *
 * Both are shortened for recognition, never for copying — every copy path, the search and the
 * export all use the full stored string. What is dropped here is dropped from the pixels only.
 */

/**
 * The scheme and a leading `www.` carry nothing a reader needs to recognise a page, and in a
 * narrow header or a clipping's source line they are exactly what pushes the meaningful tail
 * of the path out of view.
 */
export function displayUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/$/, '')
}

/**
 * Just the host, for places too narrow to hold a path. Falls back to the trimmed string
 * rather than throwing — a clipping's stored URL is only ever as well-formed as the page it
 * came from, and a malformed one should still render something.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return displayUrl(url)
  }
}

/**
 * A separator between the parts of a page title, as sites actually write them. Whitespace is
 * required on both sides, which is the whole of what keeps `well-known` and `Array.prototype`
 * out of it.
 */
const SITE_TAG = /\s+(?:[-–—|·•»]|::)\s+/g

/**
 * A title with the site's own tag dropped: `Bullet Seed (move) - Bulbapedia, the
 * community-driven Pokémon encyclopedia` is a source chip 163% as wide as the row that holds
 * it, and every character past `(move)` is a fact the reader already has.
 *
 * Stripped where a source is *shown* and nowhere else, exactly as footnote markers are — the
 * search still matches the stored title, so typing "bulbapedia" still finds the clipping whose
 * chip no longer says it, and the export still writes the title whole, because the document is
 * the archive.
 *
 * **The last segment, rather than the one that names the site.** Matching the tail against the
 * host was tried and is worse: it leaves MDN and The New York Times untouched, because neither
 * brand appears in `developer.mozilla.org` or `nytimes.com`. Dropping the last segment needs no
 * knowledge of the site at all.
 *
 * What it deliberately does not handle is a breadcrumb title — `Docs - .NET API reference -
 * String.Split Method` keeps its useless head and loses its useful tail. The alternative is to
 * show whatever differs from the other chips in the row, which is correct and which makes a
 * chip's label depend on what else has been clipped; a page you never opened would rename a
 * chip you were reading. That trade is not worth making for the sites that need it, so a
 * breadcrumb degrades to the truncation it already got, and the full title stays on hover.
 */
export function withoutSiteTag(title: string): string {
  let lastSeparator = -1
  for (const match of title.matchAll(SITE_TAG)) lastSeparator = match.index

  if (lastSeparator < 0) return title

  // Sliced rather than split-and-rejoined, so a title keeps the separators the site wrote
  // between the segments that survive.
  const head = title.slice(0, lastSeparator).trim()

  // A title that is nothing but its own tag — `- Wikipedia` — has no head to fall back on, and
  // an empty chip is worse than a redundant one.
  return head || title
}
