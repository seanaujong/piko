/**
 * "Never run Piko here", on the toolbar icon's own right-click menu.
 *
 * **Why this surface and not the others.** The obvious place is a popup with a power button, the
 * way uBlock Origin does it — but `chrome.action.onClicked` and a popup are mutually exclusive,
 * and Piko's icon click already arms clipping on the page. A popup would have to take that over.
 * The action context menu costs that nothing: it hangs off the same icon, needs no page of its
 * own, and `contextMenus` is one of the permissions Chrome shows no install warning for, which
 * is the same test that kept `clipboardWrite` and `downloads` out of the manifest.
 *
 * It is also where the question already gets asked. Firefox puts per-site extension control on
 * its extensions button, and Safari asks per-site by default; Chrome offers only "On specific
 * sites", which is a whitelist — to keep Piko off one bank you would enumerate every site you
 * *do* want. So a reader who has met either other browser reaches for the icon's context menu,
 * and Chrome is the one that has to be given the item.
 *
 * **The menu is also the undo.** There is no options page yet, so a menu that could only add
 * would be a one-way door — and `exclusionChoicesFor` offers a parent host it cannot verify is
 * not a public suffix. Making the same menu offer "Run Piko on X again" is what makes that guess
 * safe to show: a wrong choice is repaired where it was made.
 */
import { excludedEntryFor, exclusionChoicesFor } from './excludedSites'
import { matchesHost, SENSITIVE_HOSTS } from '../shared/sensitiveHosts'

/**
 * What the menu shows for one page. A plain value, so the decision can be asserted without a
 * browser — the Chrome calls below are the thin part and this is the part with rules in it.
 */
export type SiteMenuItem = {
  /**
   * Carries the host and the verb, because a service worker is not alive between building the
   * menu and the click on it. Anything the handler needs that lives in a module variable is
   * gone by then; the id is the only thing Chrome hands back.
   */
  id: string
  title: string
  enabled: boolean
}

const EXCLUDE = 'piko-exclude:'
const INCLUDE = 'piko-include:'
const ALREADY = 'piko-already'

export function siteMenuItems(url: string, excluded: readonly string[]): SiteMenuItem[] {
  const choices = exclusionChoicesFor(url)
  if (choices.length === 0) return []

  // The shipped list already covers this page, and saying so is better than offering a control
  // that would do nothing. It is the one place a reader is told the built-in list exists.
  const sensitive = matchesHost(url, SENSITIVE_HOSTS)
  if (sensitive) {
    return [{ id: ALREADY, title: `Piko never runs on ${sensitive}`, enabled: false }]
  }

  const entry = excludedEntryFor(url, excluded)
  if (entry) {
    return [{ id: `${INCLUDE}${entry}`, title: `Run Piko on ${entry} again`, enabled: true }]
  }

  return choices.map((host) => ({
    id: `${EXCLUDE}${host}`,
    title: `Never run Piko on ${host}`,
    enabled: true,
  }))
}

export type SiteMenuAction = { verb: 'exclude' | 'include'; host: string }

/** The inverse of the id encoding above; `null` for the disabled item, which does nothing. */
export function actionForMenuItem(id: string): SiteMenuAction | null {
  if (id.startsWith(EXCLUDE)) return { verb: 'exclude', host: id.slice(EXCLUDE.length) }
  if (id.startsWith(INCLUDE)) return { verb: 'include', host: id.slice(INCLUDE.length) }
  return null
}
