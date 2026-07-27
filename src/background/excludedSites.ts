/**
 * The sites the reader has told Piko to stay off.
 *
 * A different concept to `shared/sensitiveHosts.ts`, and deliberately a different list. That one
 * is a claim Piko *ships* — asserted against the manifest, and tested to contain no banks,
 * because banking does not terminate and a token list of it reads as coverage while providing
 * almost none. This one is the answer that module points at: the reader's own three banks, which
 * *do* terminate, because they are theirs.
 *
 * Both are judged by `matchesHost`, so an entry covers the host it names and everything beneath
 * it. Two lists, one rule — a second matcher here is how a lookalike host gets past one of them.
 *
 * **Where it takes effect, and where it cannot.** An entry keeps the content script out of the
 * page (`contentScriptRegistration.ts` folds it into `excludeMatches`) and keeps the worker from
 * fetching it (`fetchPolicy.ts`). Neither reaches a tab that is *already open* with the script
 * loaded — a content script cannot be unloaded once injected — so `index.ts` also tells that tab
 * to stand down. What that leaves is an inert script in the page until it next loads, which is
 * stated in the menu rather than papered over: the reader asked for "not here", and "not doing
 * anything, and gone on reload" is the honest version of it.
 */
import { matchesHost } from '../shared/sensitiveHosts'

const STORAGE_KEY = 'piko.excludedSites'

/**
 * Stored in `local`, never `sync`. `PRIVACY.md` says Piko transmits nothing, and a synced list
 * of the sites a reader considers sensitive is both a transmission and, of all the things this
 * extension holds, the one least worth putting on someone else's disk.
 */
export async function readExcludedSites(): Promise<string[]> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY)
    const hosts = stored[STORAGE_KEY]
    if (!Array.isArray(hosts)) return []
    return hosts.filter((host): host is string => typeof host === 'string')
  } catch {
    // Reaching storage is the only way to know the list, so a failure has to answer *something*.
    // The empty list is the wrong direction — it runs Piko on a site the reader excluded — but
    // the alternative is refusing every site on a transient error. Chrome's local storage
    // failing at all means the extension is already in a state this cannot repair.
    return []
  }
}

export async function excludeSite(host: string): Promise<void> {
  const current = await readExcludedSites()
  if (current.includes(host)) return
  await chrome.storage.local.set({ [STORAGE_KEY]: [...current, host] })
}

export async function includeSite(host: string): Promise<void> {
  const current = await readExcludedSites()
  await chrome.storage.local.set({ [STORAGE_KEY]: current.filter((entry) => entry !== host) })
}

/** Fires when the list changes, from whichever surface changed it. */
export function onExcludedSitesChanged(listener: () => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && STORAGE_KEY in changes) listener()
  })
}

/** The entry covering this URL, or `null`. Named so a caller can say which entry it would undo. */
export function excludedEntryFor(url: string, excluded: readonly string[]): string | null {
  return matchesHost(url, excluded)
}

/**
 * The hosts worth offering to exclude when the reader is standing on `url`, most specific first.
 *
 * A bank is the case this exists for, and a bank is rarely one host: the reader signs in at
 * `chase.com` and is handed to `secure.chase.com`. Excluding only the host in the address bar
 * would leave Piko running on the other half of the same institution, so where there is a parent
 * to offer, it is offered — Vimium's exclusion rules do the same thing by pre-filling a pattern
 * the reader can widen.
 *
 * **The parent is offered, never guessed.** Getting from a hostname to its registrable domain
 * needs the Public Suffix List, which an extension has no access to, so `www.bbc.co.uk` offers
 * `co.uk` as its parent and there is no honest way from here to know that is too broad. Two
 * things make that acceptable and neither is the guess being right: the menu prints the exact
 * string, so nothing is hidden from the reader choosing it; and the choice can be undone from two
 * places, the menu that made it and the list on the options page — which is the one that answers
 * a reader who took the parent, since undoing from the menu means first finding a page on a site
 * they have just turned Piko off on.
 */
export function exclusionChoicesFor(url: string): string[] {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return []
  }
  // Nothing to offer for a page Piko could never run on anyway — `chrome://`, the Web Store,
  // another extension's pages. Excluding those would be a control that changes nothing.
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return []

  const hostname = parsed.hostname.toLowerCase()
  if (!hostname) return []

  // An address literal has no parent to walk up to, and `matchesHost`'s dot-anchored suffix rule
  // would read `1.2.3.4` as a domain whose parent is `2.3.4`. Offer the literal and stop.
  if (hostname.startsWith('[') || /^[\d.]+$/.test(hostname)) return [hostname]

  // `www` is the one label that is never the distinguishing part of a site, so a reader on
  // `www.chase.com` means `chase.com` and would be surprised to have excluded only the one.
  const site = hostname.startsWith('www.') ? hostname.slice(4) : hostname
  const labels = site.split('.')
  if (labels.length < 3) return [site]
  return [site, labels.slice(1).join('.')]
}
