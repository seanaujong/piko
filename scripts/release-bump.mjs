#!/usr/bin/env node
// One command for the version bump, because it was never really one edit.
//
//   npm run release-bump patch     0.1.0 -> 0.1.1
//   npm run release-bump minor     0.1.0 -> 0.2.0
//   npm run release-bump 1.0.0     explicit
//
// A version lives in two files here: package.json (with its lockfile) and manifest.json, which
// is the one Chrome actually reads. Bumping one and forgetting the other produces a store upload
// whose version disagrees with the tag it was cut from, and nothing notices until much later.
// npm's own `version` command still does the package.json and lockfile work — defaults first, no
// reimplementation of semver — and this adds the manifest write plus the check that they agree.
//
// It deliberately does not commit, tag, or push.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const MANIFEST = new URL('../manifest.json', import.meta.url)
const PKG = new URL('../package.json', import.meta.url)

const arg = process.argv[2]
if (!arg) {
  console.error('usage: npm run release-bump <major|minor|patch|X.Y.Z>')
  process.exit(2)
}

// npm rewrites package.json AND package-lock.json, and validates the argument for us.
execFileSync('npm', ['version', '--no-git-tag-version', arg], { stdio: 'pipe' })
const after = JSON.parse(readFileSync(PKG, 'utf8')).version

// Only the version field is rewritten, so the manifest's key order and formatting survive — a
// JSON round-trip would reorder a file that is read far more often by people than by scripts.
const raw = readFileSync(MANIFEST, 'utf8')
const patched = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${after}"`)
if (patched === raw) {
  console.error('✗ could not find a "version" field in manifest.json — bump it by hand.')
  process.exit(1)
}
writeFileSync(MANIFEST, patched)

const manifestVersion = JSON.parse(readFileSync(MANIFEST, 'utf8')).version
if (manifestVersion !== after) {
  console.error(`✗ manifest is ${manifestVersion} but package.json is ${after}`)
  process.exit(1)
}

// The Chrome Web Store accepts only dot-separated integers, each at most 65535. A semver
// pre-release or build tag ("1.0.0-rc.1") passes npm and is rejected at upload, which is a long
// way to travel to find out.
const parts = after.split('.')
const legal =
  parts.length >= 1 &&
  parts.length <= 4 &&
  parts.every((part) => /^\d+$/.test(part) && Number(part) <= 65535)
if (!legal) {
  console.error(`✗ ${after} is not a version the Chrome Web Store will accept`)
  process.exit(1)
}

console.log(`bumped → ${after} (package.json, package-lock.json, manifest.json)`)
