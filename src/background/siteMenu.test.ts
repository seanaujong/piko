import { describe, expect, it } from 'vitest'
import { actionForMenuItem, siteMenuItems } from './siteMenu'

const titles = (url: string, excluded: string[] = []) =>
  siteMenuItems(url, excluded).map((item) => item.title)

describe('what the icon menu offers', () => {
  it('offers to exclude the site the reader is on', () => {
    expect(titles('https://chase.com/')).toEqual(['Never run Piko on chase.com'])
  })

  it('offers the parent too, so a bank on a subdomain can be excluded whole', () => {
    expect(titles('https://secure.chase.com/')).toEqual([
      'Never run Piko on secure.chase.com',
      'Never run Piko on chase.com',
    ])
  })

  it('turns into the undo once the site is excluded', () => {
    // The menu is the only repair surface there is — there is no options page — so a wrong
    // choice has to be undoable from where it was made.
    expect(titles('https://secure.chase.com/', ['chase.com'])).toEqual([
      'Run Piko on chase.com again',
    ])
  })

  it('names the entry that matched, not the host the reader is standing on', () => {
    const [item] = siteMenuItems('https://a.b.chase.com/', ['chase.com'])
    expect(item?.id).toBe('piko-include:chase.com')
  })

  it('says so, without offering a control, where the shipped list already refuses', () => {
    const items = siteMenuItems('https://mail.google.com/', [])
    expect(items).toEqual([
      { id: 'piko-already', title: 'Piko never runs on mail.google.com', enabled: false },
    ])
  })

  it('draws nothing on a page Piko could never run on', () => {
    expect(siteMenuItems('chrome://extensions', [])).toEqual([])
  })
})

describe('what a click means', () => {
  it('round-trips the host through the id, because the worker is not alive to remember it', () => {
    const [item] = siteMenuItems('https://chase.com/', [])
    expect(actionForMenuItem(item!.id)).toEqual({ verb: 'exclude', host: 'chase.com' })
  })

  it('round-trips the undo the same way', () => {
    const [item] = siteMenuItems('https://chase.com/', ['chase.com'])
    expect(actionForMenuItem(item!.id)).toEqual({ verb: 'include', host: 'chase.com' })
  })

  it('reads the disabled item as no action at all', () => {
    expect(actionForMenuItem('piko-already')).toBeNull()
  })

  it('ignores an id it does not recognise', () => {
    // One listener serves every menu item Piko creates, so an item added later for some other
    // purpose must read as "not mine to act on" rather than falling through to a host named ''.
    expect(actionForMenuItem('piko-something-else')).toBeNull()
  })
})
