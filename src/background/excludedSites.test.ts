import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  excludeSite,
  excludedEntryFor,
  exclusionChoicesFor,
  includeSite,
  readExcludedSites,
} from './excludedSites'

describe('what the menu offers to exclude', () => {
  it('offers the bare site for a two-label host', () => {
    expect(exclusionChoicesFor('https://chase.com/login')).toEqual(['chase.com'])
  })

  it('drops www, because it is never the distinguishing part of a site', () => {
    // A reader on www.chase.com means chase.com. Excluding only the www host would leave Piko
    // running on every other subdomain of their bank.
    expect(exclusionChoicesFor('https://www.chase.com/')).toEqual(['chase.com'])
  })

  it('offers the parent as well, because a bank is rarely one host', () => {
    // The case this whole feature exists for: sign in at chase.com, get handed to secure.chase.com.
    expect(exclusionChoicesFor('https://secure.chase.com/dashboard')).toEqual([
      'secure.chase.com',
      'chase.com',
    ])
  })

  it('offers nothing for a page Piko could never run on', () => {
    expect(exclusionChoicesFor('chrome://extensions')).toEqual([])
    expect(exclusionChoicesFor('chrome-extension://abc/onboarding.html')).toEqual([])
    expect(exclusionChoicesFor('about:blank')).toEqual([])
    expect(exclusionChoicesFor('not a url')).toEqual([])
  })

  it('does not walk up an address literal, which has no parent', () => {
    // The dot-anchored suffix rule would otherwise read 1.2.3.4 as a domain under 2.3.4.
    expect(exclusionChoicesFor('http://192.168.1.1/')).toEqual(['192.168.1.1'])
    expect(exclusionChoicesFor('http://[::1]:8080/')).toEqual(['[::1]'])
  })

  it('offers a parent it cannot know is a public suffix, and that is the known cost', () => {
    // Getting to the registrable domain needs the Public Suffix List, which an extension cannot
    // reach. What makes this safe to show is not the guess being right: the menu prints the exact
    // string, and the same menu offers the undo. Pinned so the cost stays visible rather than
    // being rediscovered as a bug.
    expect(exclusionChoicesFor('https://www.bbc.co.uk/news')).toEqual(['bbc.co.uk', 'co.uk'])
  })
})

describe('which entry covers a page', () => {
  it('covers everything beneath the entry', () => {
    expect(excludedEntryFor('https://secure.chase.com/x', ['chase.com'])).toBe('chase.com')
  })

  it('names the entry rather than the host, so the undo can say what it would remove', () => {
    expect(excludedEntryFor('https://a.b.chase.com/', ['chase.com'])).toBe('chase.com')
  })

  it('is anchored on a dot, so a lookalike host is not covered', () => {
    expect(excludedEntryFor('https://notchase.com/', ['chase.com'])).toBeNull()
  })

  it('says no for an empty list rather than throwing', () => {
    expect(excludedEntryFor('https://chase.com/', [])).toBeNull()
  })
})

describe('the stored list', () => {
  let store: Record<string, unknown>

  beforeEach(() => {
    store = {}
    vi.unstubAllGlobals()
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items)
          }),
        },
      },
    })
  })

  it('starts empty', async () => {
    await expect(readExcludedSites()).resolves.toEqual([])
  })

  it('keeps what was added', async () => {
    await excludeSite('chase.com')
    await expect(readExcludedSites()).resolves.toEqual(['chase.com'])
  })

  it('does not add the same host twice', async () => {
    await excludeSite('chase.com')
    await excludeSite('chase.com')
    await expect(readExcludedSites()).resolves.toEqual(['chase.com'])
  })

  it('removes only the entry named', async () => {
    await excludeSite('chase.com')
    await excludeSite('bank.example')
    await includeSite('chase.com')
    await expect(readExcludedSites()).resolves.toEqual(['bank.example'])
  })

  it('ignores a stored value that is not a list of strings', async () => {
    // Storage is shared with anything else that can write to this profile, and a corrupt value
    // must not take the worker down on a path that every fetch goes through.
    store['piko.excludedSites'] = { nonsense: true }
    await expect(readExcludedSites()).resolves.toEqual([])

    store['piko.excludedSites'] = ['chase.com', 42, null]
    await expect(readExcludedSites()).resolves.toEqual(['chase.com'])
  })
})
