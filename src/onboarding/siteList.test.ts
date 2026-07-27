import { describe, expect, it, vi } from 'vitest'
import { renderSiteList, siteRows } from './siteList'

const SHIPPED = ['mail.google.com', 'slack.com']

describe('the rows of the sites section', () => {
  it('puts what the reader added above what Piko ships refusing', () => {
    expect(siteRows(['bank.example.test'], SHIPPED)).toEqual([
      { host: 'bank.example.test', source: 'reader' },
      { host: 'mail.google.com', source: 'shipped' },
      { host: 'slack.com', source: 'shipped' },
    ])
  })

  it('prints a host on both lists once, and leaves it the reader’s to remove', () => {
    // Reachable without anyone doing anything odd: a release adds a host to SENSITIVE_HOSTS that
    // a reader had already excluded by hand. The entry is theirs, so the control stays theirs.
    expect(siteRows(['slack.com'], SHIPPED)).toEqual([
      { host: 'slack.com', source: 'reader' },
      { host: 'mail.google.com', source: 'shipped' },
    ])
  })

  it('says nothing twice when the stored list repeats itself', () => {
    expect(siteRows(['a.test', 'a.test'], []).map((row) => row.host)).toEqual(['a.test'])
  })

  it('is all shipped rows before the reader has excluded anything', () => {
    expect(siteRows([], SHIPPED).every((row) => row.source === 'shipped')).toBe(true)
  })
})

/** The rendered list, because "which rows carry a control" is the rule worth seeing land. */
describe('the sites section as drawn', () => {
  const draw = (excluded: string[], letBackOn = (): void => {}): HTMLElement => {
    const host = document.createElement('div')
    host.append(renderSiteList(siteRows(excluded, SHIPPED), letBackOn))
    return host
  }

  it('offers the undo on the reader’s rows and on no others', () => {
    const drawn = draw(['bank.example.test'])

    const undos = [...drawn.querySelectorAll('.site-undo')]
    expect(undos).toHaveLength(1)
    expect(undos[0]?.closest('.site')?.querySelector('.site-host')?.textContent).toBe(
      'bank.example.test',
    )

    // The shipped rows are inside the fold, and each says why it has no control instead.
    const shippedRows = [...(drawn.querySelector('details')?.querySelectorAll('.site') ?? [])]
    expect(shippedRows).toHaveLength(2)
    expect(shippedRows.every((row) => row.querySelector('.site-undo') === null)).toBe(true)
    expect(shippedRows[0]?.querySelector('.site-note')?.textContent).toBe('always off')
  })

  it('names the host it would let Piko back on, not the row it was drawn from', () => {
    const letBackOn = vi.fn()
    const drawn = draw(['first.test', 'second.test'], letBackOn)

    const undos = drawn.querySelectorAll<HTMLButtonElement>('.site-undo')
    undos[1]?.click()

    expect(letBackOn).toHaveBeenCalledWith('second.test')
  })

  it('says the list is empty rather than drawing an empty list', () => {
    const drawn = draw([])

    expect(drawn.querySelector('.sites-empty')?.textContent).toContain('have not turned Piko off')
    expect(drawn.querySelectorAll('.site-undo')).toHaveLength(0)
    // The shipped group is still there, and its summary is where the count is stated.
    expect(drawn.querySelector('summary')?.textContent).toBe(
      '2 sites Piko always refuses, whatever you do',
    )
  })
})
