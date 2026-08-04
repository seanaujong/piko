import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright'
import { testManifestFrom } from './testManifest'

/**
 * Getting the actually-loaded extension in front of a page.
 *
 * Shared by the end-to-end suite and the journal bench, because the two launch requirements
 * below are non-obvious, were established by measurement, and would be worth rediscovering
 * exactly once:
 *
 *  - `channel: 'chromium'`, NOT `channel: 'chrome'`. Branded Chrome now ignores
 *    `--load-extension`, and no amount of `--disable-features` brought it back — the extension
 *    simply never appears in chrome://extensions.
 *  - Full Chromium, not the headless shell. `headless: true` alone resolves to
 *    chrome-headless-shell, which has no extension support at all; pairing it with
 *    `channel: 'chromium'` selects the complete browser in new-headless mode, which does.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const DIST = path.join(ROOT, 'dist')
const DIST_TEST = path.join(ROOT, 'dist-test')
const FIXTURES = path.join(HERE, 'fixtures')

/** Everything the panel renders lives in one open shadow root on a child of <html>. */
export const SHADOW = `[...document.documentElement.children].find(e => e.shadowRoot).shadowRoot`

/** Always exercise the shipped bundle rather than the source it was built from. */
export function buildExtension(): void {
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' })
}

/**
 * Builds the shipped bundle, then loads it under a manifest that declares the content script
 * statically instead of registering it after a grant.
 *
 * **Why this exists, since a test build is a thing worth being suspicious of.** Piko ships with
 * `optional_host_permissions`, so on load it can reach nothing until the reader grants access —
 * and no automation can perform that grant. Measured, three ways: `permissions.request()` from a
 * real click never resolves because the grant is a native dialog nothing can answer;
 * `chrome://extensions` renders no site-access control until something is already granted; and
 * writing `granted_permissions` into the profile's Secure Preferences persists in the file but is
 * ignored at runtime. Without this substitution the suite could not load a content script into
 * anything, and would test nothing.
 *
 * **What it deliberately does not change.** Only the keys in `TEST_MANIFEST_KEYS`, which describe
 * how the script gets into a page. `content.js` and `background.js` are the shipped bytes,
 * untouched, and `manifest.test.ts` fails the build if anything else drifts.
 *
 * **What is therefore untested, and belongs to `MANUAL.md`.** The grant flow itself: the
 * onboarding button, `permissions.onAdded` firing, and `syncContentScriptRegistration` putting
 * the script in place. `contentScriptRegistration.test.ts` covers that logic against a fake
 * `chrome`, but nothing here proves it works in a real browser. That is the price of the
 * substitution, and it is why the price is kept to one button and one listener.
 */
export function buildTestExtension(): string {
  buildExtension()

  rmSync(DIST_TEST, { recursive: true, force: true })
  cpSync(DIST, DIST_TEST, { recursive: true })

  const shipped = JSON.parse(readFileSync(path.join(DIST, 'manifest.json'), 'utf8'))
  writeFileSync(
    path.join(DIST_TEST, 'manifest.json'),
    JSON.stringify(testManifestFrom(shipped), null, 2),
  )

  return DIST_TEST
}

/**
 * Drives the real gesture, with real input.
 *
 * Dispatching a DragEvent pair is far easier and no longer works: `startDragTracking` refuses
 * an untrusted event, because a page that can synthesise one can choose what the background
 * worker fetches. That guard is only worth having if the shipped bundle is what gets tested, so
 * everything here pays the cost of driving the mouse — which also makes this the only place the
 * trusted path is exercised at all (`dragTracking.test.ts` explains the split).
 *
 * The move happens in steps because Chrome starts a native drag on movement *while* the button
 * is down; a single jump can be delivered as one event and never crosses the threshold.
 *
 * Shared rather than owned by the suite because the screenshots in the onboarding page are
 * captured from this same gesture. A picture of a preview that opened some other way would be a
 * picture of something no reader can reproduce.
 */
export async function dragElement(page: Page, link: Locator): Promise<void> {
  /*
   * The first client rect, and not the bounding box. They are the same rectangle for a link that
   * fits on one line, and for a link that wraps they are very different: the bounding box is the
   * union of both line fragments, so its centre can fall in the gap between the lines or onto the
   * prose beside them. The mouse then presses something that is not the link, no `dragstart` ever
   * fires, and the failure is indistinguishable from a listener that was never attached — which
   * is a long way to travel for a link that grew one word too long.
   */
  const box = await link.evaluate((element) => {
    const rect = element.getClientRects()[0]
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
  })
  if (!box || box.width === 0 || box.height === 0) throw new Error(`nothing to drag at ${link}`)

  const fromX = box.x + box.width / 2
  const fromY = box.y + box.height / 2
  await page.mouse.move(fromX, fromY)
  await page.mouse.down()
  await page.mouse.move(fromX + 30, fromY + 30, { steps: 12 })
  await page.mouse.move(fromX + 90, fromY + 70, { steps: 12 })
  await page.mouse.up()
}

export type FixtureServer = { base: string; close: () => void }

/**
 * What a fixture is served as, by extension.
 *
 * The suite needs to serve things that are not pages, because what Piko does with a response
 * turns entirely on this header — a `.docx` and an article are the same drag and the same
 * fetch, and differ only here. Anything unlisted is served as HTML, which is what nearly every
 * fixture is.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

const contentTypeFor = (name: string): string =>
  CONTENT_TYPES[path.extname(name).toLowerCase()] ?? 'text/html; charset=utf-8'

/**
 * Serves `e2e/fixtures`, plus any pages generated for one run — a bench needs an article far
 * larger than anything worth committing, and generating it keeps the repo small. The same
 * escape hatch carries the binary-ish fixtures, for the same reason.
 *
 * **Two names carry a header the rest do not**, both because the header is the thing under
 * test and cannot be expressed inside the file. `csp-host.html` is served with the directive
 * that broke extraction in the wild: a `<base>` element is governed by the *host page's*
 * base-uri policy even inside a DOMParser document, so this page is the only place the suite
 * can tell a mechanism the page can veto from one it cannot — Wikipedia serves exactly this.
 * Anything named `attached-*` is served as `Content-Disposition: attachment`, which is a
 * server saying "save this, don't show it" and is the one header that turns a type Chrome
 * renders into a file on the reader's disk.
 */
export async function serveFixtures(
  generated: Readonly<Record<string, string>> = {},
): Promise<FixtureServer> {
  const server: Server = createServer((request, response) => {
    const requested = (request.url === '/' ? '/index.html' : (request.url ?? '/')).split('?')[0]!
    const name = path.basename(requested)

    const headers: Record<string, string> = { 'Content-Type': contentTypeFor(name) }
    if (name === 'csp-host.html') headers['Content-Security-Policy'] = "base-uri 'self'"
    if (name.startsWith('attached-')) {
      headers['Content-Disposition'] = `attachment; filename="${name.slice('attached-'.length)}"`
    }

    const made = generated[requested]
    if (made !== undefined) {
      response.writeHead(200, headers)
      response.end(made)
      return
    }

    const file = path.join(FIXTURES, name)
    if (!existsSync(file)) {
      response.writeHead(404)
      response.end('not found')
      return
    }

    response.writeHead(200, headers)
    response.end(readFileSync(file))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => server.close(),
  }
}

export async function launchWithExtension(): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    // Spelled out because the export test depends on it: a download is how the journal leaves
    // the extension, and Playwright is what turns that effect into a file the suite can read.
    acceptDownloads: true,
    args: [`--disable-extensions-except=${DIST_TEST}`, `--load-extension=${DIST_TEST}`],
  })

  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent('serviceworker', { timeout: 20_000 })
  }
  return context
}
