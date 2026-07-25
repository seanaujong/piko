/**
 * Builds a scroll-to-text URL — the source page plus a `:~:text=` directive naming the
 * clipped sentence — so following a clipping lands on that sentence, highlighted by the
 * browser, rather than at the top of a long article.
 *
 * The directive never appears in anything displayed. A reader recognises a page by its URL,
 * and a percent-encoded sentence stapled to the end of one is noise; it is attached only at
 * the moment of linking out.
 */

/**
 * `-` separates the parts of a text directive, so it has to be escaped inside one.
 * encodeURIComponent already escapes `,` and `&`, the other two characters with meaning here.
 */
const encodePart = (part: string): string => encodeURIComponent(part).replace(/-/g, '%2D')

/**
 * Words taken from each end when a sentence is too long to spell out. The directive's
 * `textStart,textEnd` form selects the same range as the full text at a fraction of the
 * length, which matters because these URLs get pasted into places that mangle long ones.
 */
const WORDS_AT_EACH_END = 6

/**
 * Citation markers are kept, not stripped. The browser matches against the page's rendered
 * text, and a marker like `[a]` IS part of that text — so removing it produces a string that
 * never appears contiguously and matches nothing. Only whitespace is normalised, which the
 * matching algorithm normalises too.
 */
export function textFragmentUrl(url: string, text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean === '') return url

  const words = clean.split(' ')
  const directive =
    words.length <= WORDS_AT_EACH_END * 2
      ? encodePart(clean)
      : `${encodePart(words.slice(0, WORDS_AT_EACH_END).join(' '))},${encodePart(
          words.slice(-WORDS_AT_EACH_END).join(' '),
        )}`

  // The directive is appended to whatever fragment the URL already has, never as a second `#`.
  return `${url}${url.includes('#') ? '' : '#'}:~:text=${directive}`
}
