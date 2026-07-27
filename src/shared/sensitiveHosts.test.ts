import { describe, expect, it } from 'vitest'
import { SENSITIVE_HOSTS, excludeMatchPatterns, isSensitiveUrl } from './sensitiveHosts'

describe('the patterns the list produces', () => {
  it('covers the bare host as well as its subdomains', () => {
    // Whether Chrome's `*.example.com` also matches the bare host is a detail this project
    // would otherwise be betting on silently. Emitting both forms makes the question moot.
    expect(excludeMatchPatterns(['example.com'])).toEqual([
      '*://example.com/*',
      '*://*.example.com/*',
    ])
  })
})

describe('isSensitiveUrl', () => {
  it('matches a host on the list', () => {
    expect(isSensitiveUrl('https://mail.google.com/mail/u/0/#inbox')).toBe(true)
  })

  it('matches beneath a host on the list', () => {
    expect(isSensitiveUrl('https://my.1password.com/vaults')).toBe(true)
  })

  it('is anchored on a dot, so a lookalike host does not pass', () => {
    // The bug a bare endsWith() would have: "notbitwarden.com".endsWith("bitwarden.com").
    expect(isSensitiveUrl('https://notbitwarden.com/')).toBe(false)
  })

  it('ignores case, because hostnames are case-insensitive and links are not typed carefully', () => {
    expect(isSensitiveUrl('https://MAIL.GOOGLE.COM/')).toBe(true)
  })

  it('leaves an ordinary article alone', () => {
    expect(isSensitiveUrl('https://en.wikipedia.org/wiki/Photosynthesis')).toBe(false)
  })

  it('says no rather than throwing when handed something that is not a URL', () => {
    expect(isSensitiveUrl('not a url')).toBe(false)
  })

  it('names only categories that terminate — no banks, which cannot be enumerated', () => {
    // Guards the reasoning in the module docblock, and by extension the narrow claim the store
    // listing makes. A bank added here would make that claim broader than the list can support.
    expect(SENSITIVE_HOSTS).not.toContain('chase.com')
    expect(SENSITIVE_HOSTS.some((h) => h.includes('bank'))).toBe(false)
  })
})
