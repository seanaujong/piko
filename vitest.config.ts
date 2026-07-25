import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

/**
 * Three suites, split by what they need rather than by how fast they are.
 *
 * `unit` runs under jsdom — enough DOM for `DOMParser`, `textContent` and `Range`, which is
 * all the pure layers touch.
 *
 * `geometry` runs in real Chrome because it measures *layout*. jsdom reports every client
 * rect as zero, so these assertions would pass there while proving nothing — the exact
 * failure mode that let the highlight-band bugs live as long as they did. Chrome is used
 * via `channel: 'chrome'` so no browser is downloaded; it drives the one already installed.
 *
 * `e2e` runs the actually-loaded extension in a browser that installed it, which is the only
 * way to reach the manifest, the background worker, the message round-trip and
 * `chrome.storage` at all. It is also the slowest by an order of magnitude, and it is in the
 * gate anyway: it replaces a manual reload-and-drag loop that cost far more. `e2e/harness.ts`
 * owns the launch requirements; `e2e/MANUAL.md` covers what even this suite cannot check.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
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
