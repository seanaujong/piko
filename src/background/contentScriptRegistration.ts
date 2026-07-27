/**
 * Getting the content script into pages, once the reader has said Piko may be there.
 *
 * The manifest declares no `content_scripts` and no `host_permissions`, so on install Piko can
 * reach nothing: the install prompt says nothing about your browsing, and access is a separate,
 * explained decision made on the onboarding page. That decision is one grant covering every
 * site, not a prompt per site — the gesture Piko is built around is dragging a link on whatever
 * page you happen to be reading, and a per-site prompt would arrive one click too late every
 * time.
 *
 * What that costs is stated in `e2e/harness.ts`: no automation can complete a host grant, so the
 * suite loads a manifest that declares the script statically instead. This module is therefore
 * one of the few places where the shipped path and the tested path genuinely differ, and the
 * `declaredStatically` guard below is where they meet.
 */
import { excludeMatchPatterns, SENSITIVE_HOSTS } from '../shared/sensitiveHosts'
import { readExcludedSites } from './excludedSites'

const SCRIPT_ID = 'piko-content'

/** The access Piko asks for, in the one shape `chrome.permissions` will answer about. */
export const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] }

export function hasHostAccess(): Promise<boolean> {
  return chrome.permissions.contains(ALL_SITES)
}

/**
 * True when the loaded manifest already declares the content script.
 *
 * Only the e2e manifest does. Registering on top of a static declaration injects `content.js`
 * into every page twice, which is not a subtle failure — two panels, two hit-testers — but it is
 * an easy one to cause, because the two mechanisms are invisible to each other.
 */
function declaredStatically(): boolean {
  return (chrome.runtime.getManifest().content_scripts?.length ?? 0) > 0
}

/**
 * Brings registration into line with what the reader has granted. Safe to call repeatedly, and
 * called on every event that could change the answer.
 *
 * `registerContentScripts` resolves successfully when the extension holds no host permission and
 * the script then silently never injects — there is no error, no event, and no way to notice
 * from inside the extension. So permission is checked first rather than being inferred from the
 * call succeeding, and a refusal is logged where a developer will see it.
 */
export async function syncContentScriptRegistration(): Promise<void> {
  if (declaredStatically()) return

  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] })
  const granted = await hasHostAccess()

  if (!granted) {
    if (registered.length > 0) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] })
    return
  }

  // Two lists, one set of patterns: the categories Piko ships a refusal for, and the sites this
  // reader excluded by hand. `excludedSites.ts` says why they stay separate concepts.
  const excludeMatches = excludeMatchPatterns([...SENSITIVE_HOSTS, ...(await readExcludedSites())])

  // Registration is not write-once any more — the reader's list changes under it, and a
  // registration that merely *exists* is no longer evidence it excludes the right sites. So the
  // patterns are compared rather than the presence, and a drift is pushed with `update` rather
  // than an unregister/register pair, which would leave a window where the script matches
  // everything.
  const current = registered[0]
  if (current) {
    if (samePatterns(current.excludeMatches ?? [], excludeMatches)) return
    await chrome.scripting.updateContentScripts([{ id: SCRIPT_ID, excludeMatches }])
    return
  }

  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      matches: ['<all_urls>'],
      excludeMatches,
      js: ['content.js'],
      runAt: 'document_idle',
      // Survives a browser restart, so the grant is asked for once and not once per session.
      persistAcrossSessions: true,
    },
  ])
}

/** Order is not part of the meaning, so a reordering must not read as a change worth pushing. */
function samePatterns(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const have = new Set(a)
  return b.every((pattern) => have.has(pattern))
}
