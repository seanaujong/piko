import * as esbuild from 'esbuild'
import { cpSync, mkdirSync, rmSync } from 'node:fs'

/**
 * `--release` drops the sourcemaps, and is what `npm run package` builds with.
 *
 * They are worth having while developing and are dead weight in a shipped extension: 628kB of
 * map against a 257kB bundle, downloaded by every user, pointing at TypeScript nobody installing
 * from the store has. Nothing is hidden by leaving them out — the bundle is unminified either
 * way, which is what the Chrome Web Store's readable-code requirement actually asks for.
 */
const release = process.argv.includes('--release')

/**
 * Cleared first, so `dist/` only ever holds what this build put there.
 *
 * esbuild overwrites what it emits and knows nothing about what it no longer emits, so anything
 * a build stops producing simply stays — which is how the first release zip shipped the
 * sourcemaps that `--release` had just been written to leave out. A directory that accumulates
 * is not a description of the extension, and this one gets loaded by the e2e suite and zipped
 * for the store.
 */
rmSync('dist', { recursive: true, force: true })

await esbuild.build({
  entryPoints: {
    content: 'src/content/index.ts',
    background: 'src/background/index.ts',
    onboarding: 'src/onboarding/index.ts',
  },
  outdir: 'dist',
  bundle: true,
  format: 'iife',
  target: 'chrome115',
  sourcemap: !release,
  jsx: 'automatic',
  jsxImportSource: 'preact',
})

mkdirSync('dist/icons', { recursive: true })
cpSync('manifest.json', 'dist/manifest.json')
// The page the install opens. It is the only place host access is asked for, so it ships with
// every build rather than being a release-only extra.
cpSync('public/onboarding.html', 'dist/onboarding.html')
// The rasterized sizes only. `icon.svg` is what those are rendered FROM — `npm run icons` and
// the contact sheet both read it out of public/ — so shipping it would put the source drawing
// in every install for nothing.
cpSync('public/icons', 'dist/icons', {
  recursive: true,
  filter: (source) => !source.endsWith('.svg'),
})
