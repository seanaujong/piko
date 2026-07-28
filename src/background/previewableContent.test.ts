import { describe, expect, it } from 'vitest'
import { handlingFor, isAttachment, type ContentHandling } from './previewableContent'

/**
 * The table is the point. Each row is a `Content-Type` a real server sends, and the column that
 * matters is the third: `refuse` is the answer that keeps a file off the reader's disk, so a row
 * moving out of it is the change worth noticing in a diff.
 */
describe('what the panel may do with a response', () => {
  const cases: readonly [string, ContentHandling, string][] = [
    ['text/html', 'extract', 'the ordinary article'],
    ['text/html; charset=utf-8', 'extract', 'the same, with the parameter every server sends'],
    ['TEXT/HTML', 'extract', 'the header is case-insensitive'],
    ['application/xhtml+xml', 'extract', 'a W3C specification — prose, and extractable'],
    ['application/xhtml+xml; charset=utf-8', 'extract', 'the same, parameterised'],
    ['application/pdf', 'frame', 'a paper: Chrome renders it, Readability cannot read it'],
    ['text/plain', 'frame', 'a raw file from a code host'],
    ['image/jpeg', 'frame', 'a link straight to a photograph'],
    ['image/svg+xml', 'frame', 'a diagram'],
    ['application/zip', 'refuse', 'a release asset — this is the download'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'refuse', 'a .docx handout'],
    ['application/octet-stream', 'refuse', 'the type a server sends when it has no idea'],
    ['text/csv', 'refuse', 'an export link, which Chrome saves rather than shows'],
    ['video/x-matroska', 'refuse', 'a container Chrome has no decoder for'],
    ['video/mp4', 'refuse', 'and the one it does — media is out wholesale, see the list'],
    ['', 'refuse', 'a server that named no type at all'],
  ]

  for (const [contentType, expected, why] of cases) {
    it(`${expected}s ${contentType || '(no type)'} — ${why}`, () => {
      expect(handlingFor(contentType)).toBe(expected)
    })
  }

  it('refuses a type it has never heard of, rather than trying it', () => {
    expect(handlingFor('application/vnd.invented-next-year')).toBe('refuse')
  })
})

describe('a server declaring its response a file', () => {
  it('reads the disposition, filename and all', () => {
    expect(isAttachment('attachment; filename="report.zip"')).toBe(true)
  })

  it('reads it however it is spelled or spaced', () => {
    expect(isAttachment('Attachment')).toBe(true)
    expect(isAttachment('  ATTACHMENT; filename=x')).toBe(true)
  })

  it('leaves inline responses alone', () => {
    expect(isAttachment('inline')).toBe(false)
    expect(isAttachment('inline; filename="paper.pdf"')).toBe(false)
    expect(isAttachment('')).toBe(false)
  })

  it('is not fooled by a filename that merely contains the word', () => {
    expect(isAttachment('inline; filename="attachment.pdf"')).toBe(false)
  })
})
