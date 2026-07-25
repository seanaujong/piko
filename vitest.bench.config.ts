import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * The benches, kept out of `npm test` on purpose.
 *
 * They print measurements rather than asserting bounds, and they take an order of magnitude
 * longer than the suites do — both of which make them wrong to put in the gate that runs
 * before every commit. `npm run bench` is the way in.
 *
 * Same split as the suites, for the same reason: what runs on the page is measured in real
 * Chrome, because jsdom lays nothing out and would report zero-cost geometry.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'reading',
          include: ['bench/reading.bench.ts'],
          testTimeout: 120_000,
          browser: {
            enabled: true,
            provider: playwright({ launchOptions: { channel: 'chrome' } }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'journal',
          include: ['bench/journal.bench.ts'],
          environment: 'node',
          testTimeout: 300_000,
          hookTimeout: 300_000,
          // One browser, one profile, one storage area.
          fileParallelism: false,
        },
      },
    ],
  },
})
