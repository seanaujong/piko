import { describe, expect, it } from 'vitest'
import { displayUrl, hostOf } from './formatUrl'

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
