import { describe, expect, it } from 'vitest'
import { fetchRefusal as refusalFor } from './fetchPolicy'

/** The page doing the dragging, unless a test cares. Public, which is the ordinary case. */
const FROM_PUBLIC = 'https://news.example.com'
const FROM_LOCAL = 'http://127.0.0.1:8080'

/**
 * The reader's excluded-site list, defaulted away for the tests that predate it — they are about
 * network tiers and the shipped list, and threading an empty array through every one of them
 * would say the two concerns are related when they are not. The tests that *are* about it pass
 * it explicitly, at the bottom of this file.
 */
const fetchRefusal = (url: string, pageOrigin: string, excluded: readonly string[] = []) =>
  refusalFor(url, pageOrigin, excluded)

const refused = (url: string, pageOrigin = FROM_PUBLIC) => fetchRefusal(url, pageOrigin) !== null

describe('what the worker will fetch', () => {
  it('opens an ordinary public article', () => {
    expect(fetchRefusal('https://en.wikipedia.org/wiki/Photosynthesis', FROM_PUBLIC)).toBeNull()
  })

  it('opens a public address that merely looks unusual', () => {
    expect(fetchRefusal('https://8.8.8.8/', FROM_PUBLIC)).toBeNull()
  })
})

describe('reaching across network tiers', () => {
  it.each([
    ['loopback', 'http://127.0.0.1:8080/admin'],
    ['loopback by name', 'http://localhost:3000/'],
    ['a home router', 'http://192.168.1.1/'],
    ['private class A', 'http://10.0.0.5/'],
    ['private class B', 'http://172.20.1.1/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['carrier-grade NAT', 'http://100.64.0.1/'],
    ['this network', 'http://0.0.0.0/'],
    ['IPv6 loopback', 'http://[::1]:9000/'],
    ['IPv6 unique local', 'http://[fd00::1]/'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
  ])('refuses a public page reaching %s', (_what, url) => {
    expect(refused(url)).toBe(true)
  })

  it.each([
    ['decimal', 'http://2130706433/'],
    ['hex', 'http://0x7f000001/'],
    ['short form', 'http://127.1/'],
    ['IPv4 mapped into IPv6', 'http://[::ffff:127.0.0.1]/'],
  ])('refuses loopback spelled as %s, because the URL parser normalises it first', (_what, url) => {
    // The mapped form does not survive parsing as a dotted quad — it comes back as
    // `::ffff:7f00:1`, and a predicate looking for four octets inside the brackets sees none.
    expect(refused(url)).toBe(true)
  })

  it.each([
    ['a bare intranet name', 'http://jenkins/'],
    ['mDNS', 'http://printer.local/'],
    ['an internal suffix', 'http://wiki.internal/'],
  ])('refuses a public page reaching %s', (_what, url) => {
    expect(refused(url)).toBe(true)
  })

  // The other half of the rule, and the reason it is a tier check rather than a blocklist: a
  // reader on a local docs server dragging a link to another of its pages is not escalating
  // anything. Refusing that would be protecting them from themselves at the cost of the feature.
  it('allows a local page to reach another local address — same tier, no escalation', () => {
    expect(fetchRefusal('http://127.0.0.1:8080/docs/two.html', FROM_LOCAL)).toBeNull()
    expect(fetchRefusal('http://192.168.1.50/wiki', 'http://192.168.1.50')).toBeNull()
  })

  it('still lets a local page reach the public web', () => {
    expect(fetchRefusal('https://en.wikipedia.org/wiki/Photosynthesis', FROM_LOCAL)).toBeNull()
  })

  it('treats an unparseable page origin as public, refusing rather than allowing', () => {
    expect(refused('http://192.168.1.1/', 'not an origin')).toBe(true)
  })

  it('explains itself in the reader own terms, since the reason is shown to them', () => {
    expect(fetchRefusal('http://192.168.1.1/', FROM_PUBLIC)).toBe(
      'Piko does not open links to addresses on your own network.',
    )
  })
})

describe('schemes and sensitive hosts', () => {
  it.each(['file:///etc/passwd', 'chrome://settings', 'data:text/html,<h1>x', 'javascript:alert(1)'])(
    'refuses %s',
    (url) => {
      expect(refused(url)).toBe(true)
    },
  )

  it('refuses a host the reader is protected from, in the worker as well as the manifest', () => {
    // exclude_matches keeps the content script off mail.google.com. It says nothing about the
    // worker fetching it, which is the other direction of exposure and needs this.
    expect(refused('https://mail.google.com/mail/u/0/')).toBe(true)
  })

  it('refuses a sensitive host whatever tier the page sits on', () => {
    expect(refused('https://mail.google.com/mail/u/0/', FROM_LOCAL)).toBe(true)
  })

  it('refuses something that is not a URL at all rather than throwing', () => {
    expect(refused('not a url')).toBe(true)
  })
})

describe('a site the reader turned Piko off on', () => {
  const MY_BANK = ['chase.com']

  it('is refused, even though it is an ordinary public address', () => {
    // Keeping the content script off an excluded site stops Piko running *there*. It says
    // nothing about a link *to* there being dragged from somewhere else, which is a fetch of
    // that site from the reader's network position after they said not to touch it.
    expect(fetchRefusal('https://chase.com/statements', FROM_PUBLIC, MY_BANK)).not.toBeNull()
  })

  it('covers everything beneath the entry', () => {
    expect(fetchRefusal('https://secure.chase.com/', FROM_PUBLIC, MY_BANK)).not.toBeNull()
  })

  it('names the entry, because the refusal is read by the person who wrote it', () => {
    expect(fetchRefusal('https://secure.chase.com/', FROM_PUBLIC, MY_BANK)).toBe(
      'Piko is turned off on chase.com.',
    )
  })

  it('leaves a lookalike host alone', () => {
    expect(fetchRefusal('https://notchase.com/', FROM_PUBLIC, MY_BANK)).toBeNull()
  })

  it('leaves every other site alone', () => {
    expect(fetchRefusal('https://en.wikipedia.org/wiki/Bank', FROM_PUBLIC, MY_BANK)).toBeNull()
  })
})
