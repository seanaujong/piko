/**
 * What the journal costs to persist, in the extension that actually owns the storage.
 *
 * `toggle` rewrites the whole array and hands all of it to `chrome.storage.local` on every
 * single clip. That is the simplest thing that could work, and the open question is the size
 * at which it stops being reasonable — which decides whether storage should be keyed by source
 * URL so only the touched page's slice is rewritten, or whether persistence should simply be
 * debounced, or whether neither is worth doing.
 *
 * Measured in the service worker rather than through a page: it is the only context with
 * `chrome.storage` where the write can be timed without a CDP round trip in the middle of the
 * number. What is being measured is the serialise-and-write, which is the part that grows.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { BrowserContext } from 'playwright'
import { buildTestExtension, launchWithExtension } from '../e2e/harness'
import { syntheticArticle } from './article'
import { ms, spread, table } from './report'

const STORAGE_KEY = 'piko.clippings'

/** Sentences long enough to be real clippings, so the byte counts mean something. */
const article = syntheticArticle(220)

let context: BrowserContext

beforeAll(async () => {
  buildTestExtension()
  context = await launchWithExtension()
}, 180_000)

afterAll(async () => {
  await context?.close()
})

/**
 * A journal of `count` clippings spread over `sources` pages, shaped exactly like a stored
 * one. Built in Node and passed in, so the worker spends its time on storage rather than on
 * generating strings.
 */
function journal(count: number, sources: number): unknown[] {
  const now = 1_700_000_000_000
  return Array.from({ length: count }, (_, index) => ({
    text: article.sentences[index % article.sentences.length],
    sourceUrl: `https://en.wikipedia.org/wiki/Article_${index % sources}`,
    sourceTitle: `Article ${index % sources}`,
    originUrl: null,
    // Spread across sittings rather than all at one instant, so the shape matches a real read.
    at: now - index * 90_000,
  }))
}

describe('persisting the journal', () => {
  it('measures the write, the read back, and what it occupies', async () => {
    const [worker] = context.serviceWorkers()
    expect(worker).toBeDefined()

    const rows: string[][] = []

    for (const count of [1, 100, 1_000, 5_000]) {
      const clippings = journal(count, Math.max(1, Math.round(count / 8)))

      const result = (await worker!.evaluate(
        async ({ key, items, runs }) => {
          const time = async (body: () => Promise<unknown>) => {
            const samples: number[] = []
            for (let run = 0; run < runs; run += 1) {
              const started = performance.now()
              await body()
              samples.push(performance.now() - started)
            }
            samples.sort((a, b) => a - b)
            return {
              median: samples[samples.length >> 1]!,
              min: samples[0]!,
              max: samples[samples.length - 1]!,
              runs,
            }
          }

          await chrome.storage.local.clear()
          const write = await time(() => chrome.storage.local.set({ [key]: items }))
          const read = await time(() => chrome.storage.local.get(key))
          const bytes = await chrome.storage.local.getBytesInUse(key)

          return { write, read, bytes }
        },
        { key: STORAGE_KEY, items: clippings, runs: 7 },
      )) as {
        write: { median: number; min: number; max: number; runs: number }
        read: { median: number; min: number; max: number; runs: number }
        bytes: number
      }

      rows.push([
        `${count} clippings`,
        `${(result.bytes / 1024).toFixed(1)}kB`,
        `${Math.round(result.bytes / count)}B`,
        spread(result.write),
        spread(result.read),
      ])
    }

    // chrome.storage.local allows 10MB without the unlimitedStorage permission, which is the
    // ceiling the per-clipping figure should be read against.
    console.log(
      table(
        'chrome.storage.local — one whole-array rewrite per clip',
        ['journal', 'stored', 'per clipping', 'write', 'read back'],
        rows,
      ),
    )
  }, 180_000)
})

describe('toggling a clipping', () => {
  it('measures the array rewrite that precedes the write', async () => {
    const [worker] = context.serviceWorkers()
    const rows: string[][] = []

    for (const count of [1, 100, 1_000, 5_000]) {
      const clippings = journal(count, Math.max(1, Math.round(count / 8)))

      const sample = (await worker!.evaluate(
        ({ items, runs }) => {
          // The store's own toggle: find the clipping by source and text, then rebuild the
          // array around it. Copied here rather than imported because the worker cannot load
          // the content script's modules — if `clippings.ts` changes shape, this drifts, which
          // is the price of measuring it in the process that owns the storage.
          const isSame = (a: any, b: any) => a.sourceUrl === b.sourceUrl && a.text === b.text
          const toggle = (all: any[], one: any): any[] => {
            const index = all.findIndex((c) => isSame(c, one))
            return index >= 0
              ? [...all.slice(0, index), ...all.slice(index + 1)]
              : [...all, one]
          }

          // The worst case for `findIndex`: the clipping being removed is the last one.
          const target = items[items.length - 1]
          const samples: number[] = []
          for (let run = 0; run < runs; run += 1) {
            const started = performance.now()
            toggle(items as any[], target)
            samples.push(performance.now() - started)
          }
          samples.sort((a, b) => a - b)
          return {
            median: samples[samples.length >> 1]!,
            min: samples[0]!,
            max: samples[samples.length - 1]!,
            runs,
          }
        },
        { items: clippings, runs: 15 },
      )) as { median: number; min: number; max: number; runs: number }

      rows.push([`${count} clippings`, spread(sample), ms(sample.median)])
    }

    console.log(
      table(
        'store.toggle — the in-memory half, worst-case scan to the end',
        ['journal', 'rewrite', 'median'],
        rows,
      ),
    )
  }, 180_000)
})
