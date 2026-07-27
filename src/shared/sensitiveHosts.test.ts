import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SENSITIVE_HOSTS, excludeMatchPatterns, isSensitiveUrl } from './sensitiveHosts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function manifest(): {
  content_scripts: { exclude_matches?: string[] }[]
} {
  return JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))
}

describe('the manifest and the list', () => {
  // The rule this file exists for. `exclude_matches` is the only mechanism that keeps the
  // content script out of a page — the predicate below cannot, because by the time it could run
  // the script is already in the page. So the manifest is the enforcement and this list is the
  // statement of intent, and the two being equal is the whole guarantee.
  it('excludes exactly the hosts the list names, in both forms', () => {
    expect(manifest().content_scripts[0]?.exclude_matches).toEqual(excludeMatchPatterns())
  })

  it('covers the bare host as well as its subdomains', () => {
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
