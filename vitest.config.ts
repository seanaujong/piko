import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Two suites, split by what they need rather than by how fast they are.
 *
 * `unit` runs under jsdom — enough DOM for `DOMParser`, `textContent` and `Range`, which is
 * all the pure layers touch.
 *
 * `geometry` runs in real Chrome because it measures *layout*. jsdom reports every client
 * rect as zero, so these assertions would pass there while proving nothing — the exact
 * failure mode that let the highlight-band bugs live as long as they did. Chrome is used
 * via `channel: 'chrome'` so no browser is downloaded; it drives the one already installed.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['e2e/**/*.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          // One browser, one profile, one storage area — these tests share extension state.
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'geometry',
          include: ['src/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            // `channel: 'chrome'` drives the Chrome already installed rather than downloading
            // Playwright's bundled build — no 150MB fetch, and it measures layout in the same
            // engine the extension actually runs in.
            provider: playwright({ launchOptions: { channel: 'chrome' } }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
