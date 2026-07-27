import { defineConfig } from 'vitest/config'

/**
 * The onboarding page's screenshots, kept out of `npm test` for the reasons the benches are.
 *
 * It writes files rather than asserting anything, it reaches the live Wikipedia article the
 * onboarding copy names, and what it produces is judged by eye — three properties that each
 * disqualify it from a gate that runs before every commit. `npm run shots` is the way in, and
 * the files it writes are committed, so a normal build never needs it.
 *
 * Run through vitest rather than as a plain script because it drives `e2e/harness.ts`, and the
 * launch requirements in there were established by measurement and are worth having in exactly
 * one place. Node cannot resolve that import without a build step; vitest already can, which is
 * the same reason the benches are shaped this way.
 */
export default defineConfig({
  test: {
    name: 'shots',
    include: ['shots/*.shots.ts'],
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
})
