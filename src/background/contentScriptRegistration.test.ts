import { beforeEach, describe, expect, it, vi } from 'vitest'
import { syncContentScriptRegistration } from './contentScriptRegistration'
import { excludeMatchPatterns, SENSITIVE_HOSTS } from '../shared/sensitiveHosts'

/**
 * The half of the grant flow the e2e suite cannot reach.
 *
 * `harness.ts` loads a manifest that declares the content script statically, because no
 * automation can perform a host grant — so nothing in a real browser exercises "the reader
 * granted access, therefore the script gets registered". This does, against a fake `chrome`.
 *
 * It is a smaller guarantee than an end-to-end one and it is the one available. What it cannot
 * show is that Chrome then actually injects the registered script; `e2e/MANUAL.md` carries that.
 */
type FakeChrome = {
  runtime: { getManifest: () => { content_scripts?: unknown[] } }
  permissions: { contains: ReturnType<typeof vi.fn> }
  storage: { local: { get: ReturnType<typeof vi.fn> } }
  scripting: {
    getRegisteredContentScripts: ReturnType<typeof vi.fn>
    registerContentScripts: ReturnType<typeof vi.fn>
    updateContentScripts: ReturnType<typeof vi.fn>
    unregisterContentScripts: ReturnType<typeof vi.fn>
  }
}

let fake: FakeChrome

function setup(options: {
  granted: boolean
  /** What is already registered — `true` for a registration matching the current lists. */
  registered?: boolean | { excludeMatches: string[] }
  staticScripts?: boolean
  /** The reader's own excluded sites, as `excludedSites.ts` would read them back. */
  excluded?: string[]
}) {
  const excluded = options.excluded ?? []
  const registered =
    options.registered === true
      ? [{ id: 'piko-content', excludeMatches: excludeMatchPatterns([...SENSITIVE_HOSTS, ...excluded]) }]
      : options.registered
        ? [{ id: 'piko-content', ...options.registered }]
        : []

  fake = {
    runtime: {
      getManifest: () => (options.staticScripts ? { content_scripts: [{}] } : {}),
    },
    permissions: { contains: vi.fn().mockResolvedValue(options.granted) },
    storage: {
      local: { get: vi.fn().mockResolvedValue({ 'piko.excludedSites': excluded }) },
    },
    scripting: {
      getRegisteredContentScripts: vi.fn().mockResolvedValue(registered),
      registerContentScripts: vi.fn().mockResolvedValue(undefined),
      updateContentScripts: vi.fn().mockResolvedValue(undefined),
      unregisterContentScripts: vi.fn().mockResolvedValue(undefined),
    },
  }
  vi.stubGlobal('chrome', fake)
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('when the reader has granted access', () => {
  it('registers the content script for every site', async () => {
    setup({ granted: true })
    await syncContentScriptRegistration()

    expect(fake.scripting.registerContentScripts).toHaveBeenCalledTimes(1)
    const scripts = fake.scripting.registerContentScripts.mock.calls[0]?.[0]
    expect(scripts?.[0]).toMatchObject({
      id: 'piko-content',
      matches: ['<all_urls>'],
      js: ['content.js'],
      // Without this the grant would be asked for again after every browser restart.
      persistAcrossSessions: true,
    })
  })

  it('excludes the sensitive hosts, from the same list the manifest would have used', () => {
    setup({ granted: true })
    return syncContentScriptRegistration().then(() => {
      const scripts = fake.scripting.registerContentScripts.mock.calls[0]?.[0]
      expect(scripts?.[0].excludeMatches).toEqual(excludeMatchPatterns())
    })
  })

  it('does not register a second time when it is already registered', async () => {
    setup({ granted: true, registered: true })
    await syncContentScriptRegistration()
    expect(fake.scripting.registerContentScripts).not.toHaveBeenCalled()
  })
})

describe('the sites the reader excluded by hand', () => {
  it('keeps the script off them, alongside the shipped list', async () => {
    setup({ granted: true, excluded: ['chase.com'] })
    await syncContentScriptRegistration()

    const scripts = fake.scripting.registerContentScripts.mock.calls[0]?.[0]
    expect(scripts?.[0].excludeMatches).toEqual(
      excludeMatchPatterns([...SENSITIVE_HOSTS, 'chase.com']),
    )
  })

  it('pushes a newly excluded site onto a registration that already exists', async () => {
    // The case the old write-once guard got wrong: a registration existing was taken as evidence
    // it excluded the right sites, so a site excluded after the grant never took effect until
    // the next browser restart.
    setup({ granted: true, registered: true, excluded: ['chase.com'] })
    fake.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'piko-content', excludeMatches: excludeMatchPatterns(SENSITIVE_HOSTS) },
    ])

    await syncContentScriptRegistration()

    expect(fake.scripting.updateContentScripts).toHaveBeenCalledWith([
      { id: 'piko-content', excludeMatches: excludeMatchPatterns([...SENSITIVE_HOSTS, 'chase.com']) },
    ])
    // Never the unregister/register pair: that leaves a window where the script matches everything.
    expect(fake.scripting.unregisterContentScripts).not.toHaveBeenCalled()
  })

  it('leaves a registration alone when the lists have not moved', async () => {
    setup({ granted: true, registered: true, excluded: ['chase.com'] })
    await syncContentScriptRegistration()

    expect(fake.scripting.updateContentScripts).not.toHaveBeenCalled()
    expect(fake.scripting.registerContentScripts).not.toHaveBeenCalled()
  })

  it('drops a site from the patterns once the reader lets Piko back on', async () => {
    setup({ granted: true, registered: true, excluded: [] })
    fake.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'piko-content', excludeMatches: excludeMatchPatterns([...SENSITIVE_HOSTS, 'chase.com']) },
    ])

    await syncContentScriptRegistration()

    expect(fake.scripting.updateContentScripts).toHaveBeenCalledWith([
      { id: 'piko-content', excludeMatches: excludeMatchPatterns(SENSITIVE_HOSTS) },
    ])
  })

  it('does not read a host the shipped list already carries as a change', async () => {
    // The reader excludes slack.com, which ships in SENSITIVE_HOSTS. Duplicated patterns would
    // make every sync see a difference and push an update that changes nothing.
    setup({ granted: true, registered: true, excluded: ['slack.com'] })
    fake.scripting.getRegisteredContentScripts.mockResolvedValue([
      { id: 'piko-content', excludeMatches: excludeMatchPatterns(SENSITIVE_HOSTS) },
    ])

    await syncContentScriptRegistration()

    expect(fake.scripting.updateContentScripts).not.toHaveBeenCalled()
  })
})

describe('when the reader has not granted access', () => {
  // The failure this guard exists for is silent: registerContentScripts RESOLVES without host
  // permission and the script then never injects — no error, no event, nothing to notice from
  // inside the extension. So permission is checked rather than inferred from the call working.
  it('registers nothing rather than trusting the call to fail', async () => {
    setup({ granted: false })
    await syncContentScriptRegistration()
    expect(fake.scripting.registerContentScripts).not.toHaveBeenCalled()
  })

  it('withdraws a registration left over from a grant since revoked', async () => {
    setup({ granted: false, registered: true })
    await syncContentScriptRegistration()
    expect(fake.scripting.unregisterContentScripts).toHaveBeenCalledWith({ ids: ['piko-content'] })
  })
})

describe('under the manifest the e2e suite loads', () => {
  // That manifest declares the script statically. Registering on top of it injects content.js
  // into every page twice — two panels, two hit-testers — and the two mechanisms cannot see
  // each other, so nothing would report it.
  it('leaves a statically declared script alone', async () => {
    setup({ granted: true, staticScripts: true })
    await syncContentScriptRegistration()
    expect(fake.scripting.registerContentScripts).not.toHaveBeenCalled()
    expect(fake.scripting.getRegisteredContentScripts).not.toHaveBeenCalled()
  })
})
