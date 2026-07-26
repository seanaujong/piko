// Build a clean release zip of the unpacked extension: `npm run package`.
//
// Produces piko-<version>.zip from a fresh dist/ — the artifact a reader unzips and points
// "Load unpacked" at, and the exact bytes a Chrome Web Store upload wants.
//
// It builds first rather than zipping whatever dist/ happens to hold, because a stale dist/ is
// indistinguishable from a current one by looking at it, and the mistake ships.
import { execSync } from 'node:child_process'
import { createRequire } from 'node:module'

const { version } = createRequire(import.meta.url)('../package.json')
const out = `piko-${version}.zip`

// `--release` drops the sourcemaps; esbuild.config.mjs says why they should not ship.
execSync('node esbuild.config.mjs --release', { stdio: 'inherit' })

// Zips the CONTENTS of dist/, so manifest.json sits at the archive root. A zip of the folder
// itself installs as a directory containing an extension, which Chrome rejects.
execSync(`rm -f "${out}" && cd dist && zip -qr "../${out}" . -x '*.DS_Store' && cd ..`, {
  stdio: 'inherit',
  shell: '/bin/bash',
})

console.log(`packaged → ${out}`)
