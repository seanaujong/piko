/**
 * The journal written out as one Markdown file — the door out of Piko, taken all at once.
 *
 * Aimed at a plain-Markdown vault (Obsidian, and anything else that reads a folder of `.md`),
 * and that destination is what makes this different from dumping the list as text. A vault
 * supplies a shape the document has to satisfy rather than one invented here: YAML frontmatter
 * at the top becomes typed properties, each `##` is a note-in-waiting, and a quote's link is the
 * scroll-to-text URL — so following a sentence months later reopens the page *at* it, which is
 * the one thing no other clipper's export can offer.
 *
 * An earlier attempt at this linked the bare `sourceUrl` and dropped the time and the origin.
 * That is what made it useful to neither a human nor a program. Every field of `Clipping` is
 * written here instead, and that is load-bearing rather than thorough: nothing else records what
 * a reader takes out, so if the journal is cleared after an export this file has to be enough to
 * rebuild it. The document IS the archive, which is why there is no second JSON format.
 *
 * `exportedAt` is a parameter rather than a `Date.now()` inside, for the reason `ageBandOf`
 * gives: a function that reads the clock itself can only be tested at whatever time the suite
 * happens to run.
 */
import type { Clipping } from '../state/clippings'
import { sourcesInSessionOrder } from '../state/clippings'
import { textFragmentUrl } from './textFragment'

const pad = (value: number): string => String(value).padStart(2, '0')

/** Local time throughout: a reading journal is read in the timezone it was made in. */
const dayOf = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const minuteOf = (at: number): string => {
  const date = new Date(at)
  return `${dayOf(at)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * Every URL is written inside angle brackets, which is what keeps a `(` from ending the link
 * early — `https://en.wikipedia.org/wiki/Mercury_(planet)` is an ordinary source and breaks the
 * bare `[text](url)` form. Only the two characters that would close the brackets are escaped;
 * the rest of a stored URL is already percent-encoded by the browser that produced it.
 */
const target = (url: string): string =>
  `<${url.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/ /g, '%20')}>`

/**
 * Whitespace is collapsed rather than preserved. HTML collapses it when rendering, so this is
 * the sentence as the reader saw it — and a raw newline inside a blockquote would end the quote
 * halfway through the sentence.
 */
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * The line under each quote, carrying everything the quote itself cannot: where the sentence
 * lives, when it was taken, and where the reader was standing when they dragged it.
 */
const citation = (clipping: Clipping): string => {
  const parts = [
    `[at this sentence](${target(textFragmentUrl(clipping.sourceUrl, clipping.text))})`,
    minuteOf(clipping.at),
  ]
  if (clipping.originUrl !== null) parts.push(`from ${target(clipping.originUrl)}`)
  return parts.join(' · ')
}

export function journalToMarkdown(clippings: readonly Clipping[], exportedAt: number): string {
  // The same ordering the chip row uses, so the file and the pane cannot disagree about which
  // reading came first. One rule, two readers.
  const sources = sourcesInSessionOrder(clippings)

  const blocks: string[] = [
    ['---', `exported: ${dayOf(exportedAt)}`, `clippings: ${clippings.length}`, `sources: ${sources.length}`, 'tags: [piko]', '---'].join('\n'),
  ]

  for (const source of sources) {
    blocks.push(`## ${oneLine(source.sourceTitle)}`)
    blocks.push(target(source.sourceUrl))

    // Oldest first inside a source, which is the order the reader met them while reading it.
    // The pane leads with the newest because it is a feed and you have just clipped; a document
    // is read top to bottom.
    const items = clippings
      .filter((clipping) => clipping.sourceUrl === source.sourceUrl)
      .sort((a, b) => a.at - b.at)

    for (const clipping of items) {
      blocks.push(`> ${oneLine(clipping.text)}`)
      blocks.push(citation(clipping))
    }
  }

  return `${blocks.join('\n\n')}\n`
}

/** Dated, because an export is a snapshot and a vault will accumulate several. */
export const exportFilename = (exportedAt: number): string =>
  `piko-clippings-${dayOf(exportedAt)}.md`
