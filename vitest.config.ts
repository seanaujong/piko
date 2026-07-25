import { defineConfig } from 'vitest/config'

/**
 * jsdom, not node: the reducer inlines extraction (DOMParser + Readability), and sentence
 * segmentation reads `textContent` off real elements. Neither needs *layout* — they only
 * need a DOM to exist — which is exactly what jsdom provides and what keeps these tests
 * fast and deterministic.
 *
 * Anything that measures geometry (`lineBandsFor`, `lineRectsForSentence`) is deliberately
 * NOT covered here. jsdom reports every rect as zero, so a passing test would prove nothing;
 * those need a real engine and belong in a separate browser-driven suite.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
})
