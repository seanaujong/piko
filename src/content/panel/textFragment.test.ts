import { describe, expect, it } from 'vitest'
import { textFragmentUrl } from './textFragment'

const start = (url: string) => decodeURIComponent(url.split('text=')[1]!.split(',')[0]!)
const end = (url: string) => decodeURIComponent(url.split('text=')[1]!.split(',')[1] ?? '')

describe('textFragmentUrl', () => {
  it('keeps citation markers, because the rendered page contains them', () => {
    // The regression this suite exists for. Stripping `[a]`/`[1][2]` produces a string that
    // never appears contiguously on the page, so the directive matches nothing and every
    // source link silently lands at the top of the article instead of at the sentence.
    const url = textFragmentUrl(
      'https://en.wikipedia.org/wiki/Encyclopedia',
      'An encyclopedia[a] is a reference work or compendium providing summaries of knowledge, either general or special, in a particular field or discipline.[1][2]',
    )

    expect(start(url)).toBe('An encyclopedia[a] is a reference work')
    expect(end(url)).toBe('in a particular field or discipline.[1][2]')
  })

  it('escapes the three characters that have meaning inside a directive', () => {
    const url = textFragmentUrl('https://example.com/p', 'Comma, ampersand & dash - here.')

    expect(url).toContain('%2C') // ,
    expect(url).toContain('%26') // &
    expect(url).toContain('%2D') // -
    expect(url).not.toMatch(/text=[^#]*[,&-][^#]*$/)
  })

  it('spells a short sentence out whole rather than splitting it', () => {
    const url = textFragmentUrl('https://example.com/p', 'Short enough to say once.')

    expect(url).toBe('https://example.com/p#:~:text=Short%20enough%20to%20say%20once.')
  })

  it('collapses a long sentence to textStart,textEnd', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ')
    const url = textFragmentUrl('https://example.com/p', long)

    expect(start(url)).toBe('word0 word1 word2 word3 word4 word5')
    expect(end(url)).toBe('word34 word35 word36 word37 word38 word39')
    expect(url.length).toBeLessThan(long.length * 3)
  })

  it('appends to an existing fragment instead of adding a second #', () => {
    const url = textFragmentUrl('https://example.com/p#section', 'Already fragmented.')

    expect(url).toBe('https://example.com/p#section:~:text=Already%20fragmented.')
    expect(url.split('#')).toHaveLength(2)
  })

  it('normalises whitespace, which the matching algorithm also normalises', () => {
    const url = textFragmentUrl('https://example.com/p', '  Ragged\n  spacing\there.  ')

    expect(start(url)).toBe('Ragged spacing here.')
  })

  it('returns the url untouched when there is nothing to point at', () => {
    expect(textFragmentUrl('https://example.com/p', '   ')).toBe('https://example.com/p')
  })
})
