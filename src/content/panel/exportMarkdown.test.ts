import { describe, expect, it } from 'vitest'
import type { Clipping } from '../state/clippings'
import { exportFilename, journalToMarkdown } from './exportMarkdown'

/**
 * Built from a local-time constructor rather than an epoch constant, because the document is
 * stamped in local time — an epoch number would render differently depending on where the suite
 * runs, and the assertions below name exact strings.
 */
const AT = new Date(2026, 6, 25, 14, 32).getTime()

const PHOTOSYNTHESIS = 'https://en.wikipedia.org/wiki/Photosynthesis'
const CALVIN = 'https://en.wikipedia.org/wiki/Calvin_cycle'

const clip = (over: Partial<Clipping> = {}): Clipping => ({
  text: 'Photosynthesis converts light energy into chemical energy.',
  sourceUrl: PHOTOSYNTHESIS,
  sourceTitle: 'Photosynthesis',
  originUrl: null,
  at: AT,
  ...over,
})

describe('journalToMarkdown', () => {
  /**
   * The claim that makes this the archive as well as the export: clear the journal after
   * writing one of these and the file is still enough to rebuild every clipping. So every field
   * of `Clipping` has to appear somewhere in it — this is the test that fails when a new field
   * is added and quietly left out.
   */
  it('writes every field of a clipping, so the document is also the archive', () => {
    const document = journalToMarkdown(
      [clip({ text: 'Light is captured by chlorophyll.', originUrl: CALVIN })],
      AT,
    )

    expect(document).toContain('Light is captured by chlorophyll.') // text
    expect(document).toContain(PHOTOSYNTHESIS) // sourceUrl
    expect(document).toContain('## Photosynthesis') // sourceTitle
    expect(document).toContain('2026-07-25 14:32') // at
    expect(document).toContain(`from <${CALVIN}>`) // originUrl
  })

  /**
   * The mistake the first version of this made: it linked the bare page, so following a clipping
   * landed at the top of a long article with nothing highlighted. The scroll-to-text directive is
   * the whole reason an exported quote beats a copied one.
   */
  it('links the sentence, not the page it lives on', () => {
    const document = journalToMarkdown([clip({ text: 'Chlorophyll absorbs blue and red light.' })], AT)

    expect(document).toContain('#:~:text=')
    expect(document).toContain('Chlorophyll%20absorbs%20blue%20and%20red%20light.')
  })

  /**
   * The two halves of a clipping pull in opposite directions, and this is where that is visible:
   * a quote is read, so `[15]` is litter in it, while the directive is *matched* against the
   * page's rendered text, where `[15]` is really there. Strip both and every exported link
   * silently stops resolving; strip neither and a vault fills up with footnote numbers.
   */
  it('takes footnote markers out of the quote and leaves them in the link', () => {
    const document = journalToMarkdown(
      [clip({ text: "Some of this stored energy is later released as the plant's cells respire.[15]" })],
      AT,
    )

    expect(document).toContain("> Some of this stored energy is later released as the plant's cells respire.")
    expect(document).not.toContain('respire.[15]')
    // The directive still spells the marker out, percent-encoded.
    expect(document).toContain('%5B15%5D')
  })

  /**
   * `Mercury_(planet)` is an ordinary Wikipedia URL and closes a bare `[text](url)` link early,
   * leaving `planet)` as loose text. Angle brackets are what make every URL safe to write.
   */
  it('survives a url with parentheses in it', () => {
    const url = 'https://en.wikipedia.org/wiki/Mercury_(planet)'
    const document = journalToMarkdown([clip({ sourceUrl: url, sourceTitle: 'Mercury (planet)' })], AT)

    expect(document).toContain(`<${url}>`)
    expect(document).not.toContain(`(${url})`)
  })

  /** A newline inside the sentence would end the blockquote halfway through it. */
  it('keeps a sentence that spans lines inside one quote', () => {
    const document = journalToMarkdown([clip({ text: 'Pretty-printed\n   source text.' })], AT)

    expect(document).toContain('> Pretty-printed source text.')
    expect(document.split('\n').filter((line) => line.startsWith('>'))).toHaveLength(1)
  })

  it('gives each source one section, with its clippings oldest first', () => {
    const document = journalToMarkdown(
      [
        clip({ text: 'Second.', at: AT + 60_000 }),
        clip({ text: 'First.', at: AT }),
        clip({ text: 'Elsewhere.', sourceUrl: CALVIN, sourceTitle: 'Calvin cycle', at: AT + 120_000 }),
      ],
      AT,
    )

    expect(document.match(/^## /gm)).toHaveLength(2)
    expect(document.indexOf('> First.')).toBeLessThan(document.indexOf('> Second.'))
    expect(document.indexOf('## Photosynthesis')).toBeLessThan(document.indexOf('## Calvin cycle'))
  })

  it('opens with frontmatter a vault can read as properties', () => {
    const document = journalToMarkdown(
      [clip(), clip({ text: 'Elsewhere.', sourceUrl: CALVIN, sourceTitle: 'Calvin cycle' })],
      AT,
    )

    expect(document.startsWith('---\n')).toBe(true)
    expect(document).toContain('exported: 2026-07-25')
    expect(document).toContain('clippings: 2')
    expect(document).toContain('sources: 2')
    expect(document).toContain('tags: [piko]')
  })

  it('still writes a valid document when the journal is empty', () => {
    const document = journalToMarkdown([], AT)

    expect(document.startsWith('---\n')).toBe(true)
    expect(document).toContain('clippings: 0')
  })
})

describe('exportFilename', () => {
  it('dates the file, because a vault will collect several', () => {
    expect(exportFilename(AT)).toBe('piko-clippings-2026-07-25.md')
  })
})
