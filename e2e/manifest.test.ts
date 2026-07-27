import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TEST_MANIFEST_KEYS, testManifestFrom, type Manifest } from './testManifest'
import { excludeMatchPatterns } from '../src/shared/sensitiveHosts'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const shipped: Manifest = JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'))

/**
 * A test build is a thing to be suspicious of, and this is the suspicion written down.
 *
 * The e2e suite loads a manifest that is not the one users install, because a host grant cannot
 * be performed from automation (`harness.ts` has the measurements). That substitution is only
 * honest while it stays confined to *how the content script gets into a page*. Everything else —
 * every permission, the worker, the action — has to be the shipped extension, or the suite is
 * quietly testing a different program than the one being submitted.
 */
describe('the test manifest against the shipped one', () => {
  const test = testManifestFrom(shipped)

  it('differs only in the keys that describe how the script is injected', () => {
    const keys = new Set([...Object.keys(shipped), ...Object.keys(test)])
    const differing = [...keys].filter(
      (key) => JSON.stringify(shipped[key]) !== JSON.stringify(test[key]),
    )
    expect(differing.sort()).toEqual([...TEST_MANIFEST_KEYS].sort())
  })

  it('asks for exactly the permissions the shipped extension asks for', () => {
    // The key most worth pinning separately. A permission added for the convenience of a test is
    // a permission the store never reviewed, and it would hide inside the delta above.
    expect(test['permissions']).toEqual(shipped['permissions'])
  })

  it('carries the same exclusions the registration call passes', () => {
    const scripts = test['content_scripts'] as { exclude_matches: string[] }[]
    expect(scripts[0]?.exclude_matches).toEqual(excludeMatchPatterns())
  })
})

/**
 * The property Lead 1 exists for, stated as an assertion rather than left to inspection: at
 * install, Piko asks for nothing about your browsing. Re-adding either key silently restores
 * "Read and change all your data on all websites" to the install prompt, and nothing else in the
 * repository would notice.
 */
describe('the shipped manifest', () => {
  it('declares no host permissions, so the install prompt asks nothing about browsing', () => {
    expect(shipped['host_permissions']).toBeUndefined()
  })

  it('declares no content scripts — a static entry carries the broad-host warning by itself', () => {
    // Measured: an extension declaring only content_scripts, with no host_permissions at all,
    // still shows "read and change all your data on all websites" and grants <all_urls>.
    expect(shipped['content_scripts']).toBeUndefined()
  })

  it('asks for host access as an optional grant instead', () => {
    expect(shipped['optional_host_permissions']).toEqual(['<all_urls>'])
  })
})
