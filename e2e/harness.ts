import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type BrowserContext } from 'playwright'

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
const FIXTURES = path.join(HERE, 'fixtures')

/** Everything the panel renders lives in one open shadow root on a child of <html>. */
export const SHADOW = `[...document.documentElement.children].find(e => e.shadowRoot).shadowRoot`

/** Always exercise the shipped bundle rather than the source it was built from. */
export function buildExtension(): void {
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'ignore' })
}

export type FixtureServer = { base: string; close: () => void }

/**
 * Serves `e2e/fixtures`, plus any pages generated for one run — a bench needs an article far
 * larger than anything worth committing, and generating it keeps the repo small.
 */
export async function serveFixtures(
  generated: Readonly<Record<string, string>> = {},
): Promise<FixtureServer> {
  const server: Server = createServer((request, response) => {
    const requested = (request.url === '/' ? '/index.html' : (request.url ?? '/')).split('?')[0]!

    const made = generated[requested]
    if (made !== undefined) {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      response.end(made)
      return
    }

    const file = path.join(FIXTURES, path.basename(requested))
    if (!existsSync(file)) {
      response.writeHead(404)
      response.end('not found')
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
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
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  })

  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent('serviceworker', { timeout: 20_000 })
  }
  return context
}
