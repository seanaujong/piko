/**
 * The one difference between the extension that ships and the extension the suite tests.
 *
 * Kept as a pure function over the manifest object so it can be asserted without building or
 * launching anything — `manifest.test.ts` compares its output against the shipped manifest and
 * fails if they diverge anywhere outside `TEST_MANIFEST_KEYS`.
 *
 * `harness.ts` explains why the substitution is necessary at all: a host grant cannot be
 * performed from automation, so a manifest declaring `optional_host_permissions` can reach
 * nothing under test.
 */
import { excludeMatchPatterns } from '../src/shared/sensitiveHosts'

/**
 * The keys the test build may differ in, and nothing else. All three describe *how the content
 * script gets into a page* — statically at load, or dynamically after a grant. Every other key,
 * including every permission Piko asks for, has to be identical.
 */
export const TEST_MANIFEST_KEYS = [
  'content_scripts',
  'host_permissions',
  'optional_host_permissions',
] as const

export type Manifest = Record<string, unknown>

export function testManifestFrom(shipped: Manifest): Manifest {
  const manifest: Manifest = { ...shipped }
  delete manifest['optional_host_permissions']
  manifest['host_permissions'] = ['<all_urls>']
  manifest['content_scripts'] = [
    {
      matches: ['<all_urls>'],
      // The same list, from the same module, that `syncContentScriptRegistration` passes as
      // `excludeMatches`. A host added to sensitiveHosts.ts lands in both without a second edit.
      exclude_matches: excludeMatchPatterns(),
      js: ['content.js'],
      run_at: 'document_idle',
    },
  ]
  return manifest
}
