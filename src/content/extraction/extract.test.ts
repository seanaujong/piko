import { describe, expect, it } from 'vitest'
import { absolutiseUrls, extractArticle } from './extract'

const FROM = 'https://en.wikipedia.org/wiki/Tides'

function parse(body: string): Document {
  return new DOMParser().parseFromString(`<html><body>${body}</body></html>`, 'text/html')
}

describe('absolutiseUrls', () => {
  // The regression this file exists for. The previous implementation inserted a <base href>,
  // which the host page's `base-uri 'self'` directive blocks — so on Wikipedia the base never
  // took effect and every one of these came out resolved against about:blank.
  it('resolves a root-relative image against the page it came from', () => {
    const doc = parse('<img src="/images/tide.png">')
    absolutiseUrls(doc, FROM)
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(
      'https://en.wikipedia.org/images/tide.png',
    )
  })

  it('resolves a path-relative link against the directory it came from', () => {
    const doc = parse('<a href="Neap_tide">neap tides</a>')
    absolutiseUrls(doc, FROM)
    expect(doc.querySelector('a')?.getAttribute('href')).toBe(
      'https://en.wikipedia.org/wiki/Neap_tide',
    )
  })

  it('leaves an already-absolute URL as it is', () => {
    const doc = parse('<a href="https://example.com/x">x</a>')
    absolutiseUrls(doc, FROM)
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://example.com/x')
  })

  it('leaves a data URI alone rather than mangling it', () => {
    const doc = parse('<img src="data:image/gif;base64,R0lGOD">')
    absolutiseUrls(doc, FROM)
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('data:image/gif;base64,R0lGOD')
  })

  it('turns a bare fragment into a link back to the source page', () => {
    const doc = parse('<a href="#Spring_tides">spring</a>')
    absolutiseUrls(doc, FROM)
    expect(doc.querySelector('a')?.getAttribute('href')).toBe(`${FROM}#Spring_tides`)
  })

  it('keeps each srcset descriptor with its own url', () => {
    const doc = parse('<img srcset="/a.png 1x, /b.png 2x" src="/a.png">')
    absolutiseUrls(doc, FROM)
    expect(doc.querySelector('img')?.getAttribute('srcset')).toBe(
      'https://en.wikipedia.org/a.png 1x, https://en.wikipedia.org/b.png 2x',
    )
  })

  it('resolves a poster and a source inside a video', () => {
    const doc = parse('<video poster="/p.jpg"><source src="/v.mp4"></video>')
    absolutiseUrls(doc, FROM)
    expect(doc.querySelector('video')?.getAttribute('poster')).toBe(
      'https://en.wikipedia.org/p.jpg',
    )
    expect(doc.querySelector('source')?.getAttribute('src')).toBe('https://en.wikipedia.org/v.mp4')
  })

  it('leaves an empty href alone rather than pointing it at the page', () => {
    const doc = parse('<a href="">nothing</a>')
    absolutiseUrls(doc, FROM)
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('')
  })
})

describe('extractArticle', () => {
  const ARTICLE = `<html><head><title>The Nature of Tides</title></head><body>
    <article>
      <p>The tide is the rise and fall of sea levels caused by the combined effects of the
      gravitational forces exerted by the Moon and the Sun, and the rotation of the Earth.
      Tides originate in the oceans and progress towards the coastlines.</p>
      <p>Tide tables can be used for any given locale to find the predicted times and amplitude.
      The predictions are influenced by many factors including the alignment of the Sun and Moon
      and the shape of the coastline and near-shore bathymetry.</p>
      <p><a href="Neap_tide">Neap tides</a> occur when the Sun and Moon are at right angles, and
      <img src="/images/tide.png" alt="a tide chart"> shows the resulting range over a month.</p>
    </article></body></html>`

  it('carries absolute urls through into the html the panel renders', () => {
    const article = extractArticle(ARTICLE, FROM)
    expect(article).not.toBeNull()
    expect(article!.contentHtml).toContain('https://en.wikipedia.org/wiki/Neap_tide')
    expect(article!.contentHtml).toContain('https://en.wikipedia.org/images/tide.png')
    // about:blank is what a DOMParser document resolves against when nothing has been done.
    expect(article!.contentHtml).not.toContain('about:blank')
  })

  it('returns null rather than throwing on html with no article in it', () => {
    expect(extractArticle('<html><body></body></html>', FROM)).toBeNull()
  })
})
