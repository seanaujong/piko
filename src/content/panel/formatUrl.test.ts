import { describe, expect, it } from 'vitest'
import { displayUrl, hostOf, withoutSiteTag } from './formatUrl'

describe('displayUrl', () => {
  it('drops the scheme and a leading www', () => {
    expect(displayUrl('https://www.example.com/a/b')).toBe('example.com/a/b')
    expect(displayUrl('http://example.com/a')).toBe('example.com/a')
  })

  it('drops a trailing slash so a bare page reads as its host', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com')
  })

  it('keeps the path, which is the part worth recognising', () => {
    expect(displayUrl('https://en.wikipedia.org/wiki/Encyclopedia')).toBe(
      'en.wikipedia.org/wiki/Encyclopedia',
    )
  })

  it('leaves a fragment or query alone', () => {
    expect(displayUrl('https://example.com/a?q=1#frag')).toBe('example.com/a?q=1#frag')
  })
})

describe('hostOf', () => {
  it('reduces a url to its host', () => {
    expect(hostOf('https://en.wikipedia.org/wiki/Encyclopedia')).toBe('en.wikipedia.org')
  })

  it('drops www there too, so sources read consistently', () => {
    expect(hostOf('https://www.example.com/deep/path')).toBe('example.com')
  })

  it('falls back to the trimmed string rather than throwing', () => {
    // A clipping's stored url is only as well-formed as the page it came from, and a bad one
    // should still render something rather than take the whole pane down.
    expect(hostOf('not a url at all')).toBe('not a url at all')
  })
})

describe('withoutSiteTag', () => {
  it('drops the site a title ends with, whatever it separates with', () => {
    expect(
      withoutSiteTag('Bullet Seed (move) - Bulbapedia, the community-driven Pokémon encyclopedia'),
    ).toBe('Bullet Seed (move)')
    expect(withoutSiteTag('Photosynthesis - Wikipedia')).toBe('Photosynthesis')
    expect(withoutSiteTag('The Real Reason Everyone Is Tired | The Atlantic')).toBe(
      'The Real Reason Everyone Is Tired',
    )
    expect(withoutSiteTag('React – A JavaScript library for building user interfaces')).toBe(
      'React',
    )
  })

  it('drops only the last segment, so a title keeps its own middle', () => {
    // Stack Overflow leads with the tag and trails with the site. Cutting at the first
    // separator instead would leave "javascript" and throw the question away.
    expect(
      withoutSiteTag('javascript - How do I check if an object has a key? - Stack Overflow'),
    ).toBe('javascript - How do I check if an object has a key?')
  })

  it('keeps the separators the site wrote between the segments that survive', () => {
    expect(withoutSiteTag('re — Regular expression operations — Python 3.13.0 documentation')).toBe(
      're — Regular expression operations',
    )
  })

  it('leaves a title with nothing to drop exactly as it is', () => {
    expect(withoutSiteTag('How to Do Great Work')).toBe('How to Do Great Work')
    expect(withoutSiteTag('torvalds/linux: Linux kernel source tree')).toBe(
      'torvalds/linux: Linux kernel source tree',
    )
  })

  it('does not mistake a hyphen inside a word for a separator', () => {
    expect(withoutSiteTag('A well-known problem')).toBe('A well-known problem')
    expect(withoutSiteTag('Array.prototype.map()')).toBe('Array.prototype.map()')
  })

  it('keeps the whole title rather than emptying the label', () => {
    // A separator with nothing in front of it: the head is empty, and an empty chip is worse
    // than a redundant one. The leading space is what makes this a match at all.
    expect(withoutSiteTag(' - Wikipedia')).toBe(' - Wikipedia')
    expect(withoutSiteTag('')).toBe('')
  })
})
