/**
 * The sites section of Piko's options page: everywhere Piko stays off, and the only surface that
 * shows the whole of it.
 *
 * **Why the options page and not the menu.** The icon's menu can undo an exclusion, but only
 * while the reader is standing on that site — which is precisely the wrong requirement for the
 * mistake it exists to repair. `exclusionChoicesFor` offers a parent host it cannot verify is not
 * a public suffix, so a reader on `www.bbc.co.uk` may take the offer and exclude the whole of
 * `co.uk`; getting that back through the menu means first finding a page on a site they have just
 * turned Piko off on. A list they can read from a standing start is the repair surface for that.
 *
 * **Two lists, printed as one.** `SENSITIVE_HOSTS` is what Piko ships refusing and the reader's
 * list is what they added; a reader asking "what does this thing stay off?" is asking one
 * question, and two separate lists answer it twice. Only the reader's rows carry a control,
 * because letting Piko back on a host it ships refusing is a button that would change nothing.
 *
 * **Matched by name, not by the suffix rule that judges a URL.** The overlap between the lists is
 * real — a host can join `SENSITIVE_HOSTS` in a release after a reader already excluded it by
 * hand — and it is deduplicated on the exact entry, so the reader keeps the control over the
 * entry they added. Removing it moves the row into the shipped group rather than making Piko run
 * there, which is the honest thing for the row to do and explains itself while doing it. This is
 * printing two lists for someone to read, not judging a URL against them; `matchesHost` owns
 * that, and there is still only one of it.
 */
import { SENSITIVE_HOSTS } from '../shared/sensitiveHosts'

export type SiteRow = {
  host: string
  /** `shipped` rows carry no control — see the docblock above on why that button would lie. */
  source: 'reader' | 'shipped'
}

export function siteRows(
  excluded: readonly string[],
  shipped: readonly string[] = SENSITIVE_HOSTS,
): SiteRow[] {
  const reader = [...new Set(excluded)]
  const readerEntries = new Set(reader)
  return [
    ...reader.map((host): SiteRow => ({ host, source: 'reader' })),
    ...shipped
      .filter((host) => !readerEntries.has(host))
      .map((host): SiteRow => ({ host, source: 'shipped' })),
  ]
}

/**
 * The rows as DOM, rebuilt whole on every change rather than patched.
 *
 * There is no state in a row worth preserving across a rebuild — no focus that survives the row
 * disappearing, no input mid-edit — so the cheaper boundary is a plain builder and
 * `replaceChildren`. Preact earned its place in the clippings pane by having an answer to that
 * question; this has none.
 */
export function renderSiteList(rows: readonly SiteRow[], letBackOn: (host: string) => void): Node {
  const fragment = document.createDocumentFragment()

  const reader = rows.filter((row) => row.source === 'reader')
  const shipped = rows.filter((row) => row.source === 'shipped')

  if (reader.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'sites-empty'
    empty.append(
      'You have not turned Piko off anywhere yet. To do that, right-click ',
      toolbarIcon(),
      ' in your toolbar while you are on the site.',
    )
    fragment.append(empty)
  } else {
    fragment.append(
      list(
        reader.map((row) => {
          const undo = document.createElement('button')
          undo.type = 'button'
          undo.className = 'site-undo'
          undo.textContent = 'Let Piko back on'
          undo.addEventListener('click', () => letBackOn(row.host))
          return item(row.host, undo)
        }),
      ),
    )

    // Both halves of what the reader can do from here, and the one surprise in doing it: the
    // reload is needed in the letting-back-on direction only. Turning Piko off takes effect in
    // the open tabs at once.
    const note = document.createElement('p')
    note.className = 'fineprint'
    note.append(
      'Add one by right-clicking ',
      toolbarIcon(),
      ' in your toolbar while you are on the site. A tab already open on a site you let Piko back on needs a reload first: Piko can only get into a page while that page is loading.',
    )
    fragment.append(note)
  }

  // Folded away by default. Twenty-four hosts printed above the reader's own two would bury the
  // part of this section they can act on, and the count answers the question on its own.
  const always = document.createElement('details')
  const summary = document.createElement('summary')
  summary.textContent = `${shipped.length} sites Piko always refuses, whatever you do`
  always.append(
    summary,
    list(
      shipped.map((row) => {
        const note = document.createElement('span')
        note.className = 'site-note'
        note.textContent = 'always off'
        return item(row.host, note)
      }),
    ),
  )
  fragment.append(always)

  return fragment
}

/**
 * The toolbar icon at text size, inside the sentence asking the reader to click it.
 *
 * Naming a control is weaker than showing it. What the sentence sends them to is a row of small
 * pictures in browser chrome, and picking the right one out of that row is the whole difficulty —
 * so the sentence carries the picture. Same file the page's own logo comes from, which is the
 * file Chrome draws the toolbar from, so this cannot come to differ from what they are looking at.
 */
function toolbarIcon(): HTMLImageElement {
  const icon = document.createElement('img')
  icon.className = 'inline-icon'
  icon.src = 'icons/icon128.png'
  // Carries the words it replaced: read aloud, the sentence still says what to right-click.
  icon.alt = 'the Piko icon'
  return icon
}

function item(host: string, trailing: Node): HTMLLIElement {
  const row = document.createElement('li')
  row.className = 'site'

  const name = document.createElement('span')
  name.className = 'site-host'
  name.textContent = host

  row.append(name, trailing)
  return row
}

function list(items: readonly HTMLLIElement[]): HTMLUListElement {
  const sites = document.createElement('ul')
  sites.className = 'sites'
  sites.append(...items)
  return sites
}
