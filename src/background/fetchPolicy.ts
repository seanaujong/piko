/**
 * Which URLs the background worker is willing to fetch.
 *
 * The worker fetches with the extension's host access, which means it fetches from wherever the
 * *reader* sits on the network — inside their LAN, their VPN, their localhost. A page cannot
 * reach those origins itself, but it can put `<a href="http://192.168.1.1/">` in its own markup
 * and wait to be dragged. Without this predicate the extension is a way to read an origin the
 * page could not otherwise reach and hand the result back into it: a confused deputy, where the
 * deputy's privilege is the reader's network position rather than any credential.
 *
 * So the rule is that a fetch target must be somewhere the page could plausibly have linked in
 * good faith — a public web address — and not a host Piko refuses on the reader's behalf.
 *
 * **What this does not close.** `checkFrameability` follows redirects, so a public URL that
 * answers with a 302 into `192.168.1.1` is still *requested* before the final URL can be judged.
 * Applying this predicate to `response.url` keeps the body from coming back, which is the half
 * that leaks; the request itself still happened, and a GET with side effects on an internal host
 * would still have had them. Closing that properly means resolving each hop by hand, which the
 * Fetch API in an extension worker will not allow — `redirect: 'manual'` yields an opaque
 * response with no readable `Location`. The residual is named here rather than papered over.
 */
import { isSensitiveUrl } from '../shared/sensitiveHosts'

/**
 * Blocks of IPv4 space that are not publicly routable, plus the ones that are routable but
 * never a thing a reader meant to preview (multicast, reserved).
 */
function isPrivateIpv4(host: string): boolean {
  const octets = host.split('.')
  if (octets.length !== 4) return false

  const parsed = octets.map((part) => Number(part))
  if (parsed.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = parsed as [number, number, number, number]

  if (a === 0) return true // "this network"
  if (a === 10) return true // private
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local, which is also cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // private
  if (a === 192 && b === 168) return true // private
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a >= 224) return true // multicast and reserved
  return false
}

/**
 * The URL parser has already normalised the literal — `http://2130706433/`, `http://0x7f000001/`
 * and `http://127.1/` all arrive here as `127.0.0.1`, and IPv6 arrives bracketed — so this reads
 * the canonical form rather than trying to anticipate every spelling of an address.
 */
function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase()

  if (host.startsWith('[')) {
    const inner = host.slice(1, -1)
    if (inner === '::1' || inner === '::') return true
    if (/^fe[89ab]/.test(inner)) return true // fe80::/10 link-local
    if (/^f[cd]/.test(inner)) return true // fc00::/7 unique local

    // An IPv4 address wearing an IPv6 spelling. `::ffff:127.0.0.1` does not survive parsing in
    // that form — the URL serialiser rewrites the last 32 bits as two hex groups, so what
    // arrives is `::ffff:7f00:1` and a dotted-quad match never fires. Read the hex.
    const mapped = inner.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (mapped) {
      const high = Number.parseInt(mapped[1]!, 16)
      const low = Number.parseInt(mapped[2]!, 16)
      return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff].join('.'))
    }
    return false
  }

  if (isPrivateIpv4(host)) return true

  // A name with no dot in it is an intranet name by construction: `router`, `jenkins`, `wiki`.
  // The public DNS has nothing to resolve there, so nothing a reader dragged in good faith
  // points at one.
  if (!host.includes('.')) return true

  return host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')
}

/**
 * Why this URL will not be fetched, or `null` if it will be.
 *
 * A reason rather than a boolean because every refusal reaches the reader as text in the error
 * view, and "Piko does not open links to addresses on your own network" is a different thing to
 * be told than a network timeout. The caller does not have to decide how to phrase it.
 *
 * **The private-address rule is about escalation, not about private addresses.** Refusing them
 * outright is the wrong rule twice over: it breaks a reader on a local docs server dragging a
 * link to another page of it, and it protects nothing extra, because a page that already sits
 * on the private network is not gaining reach by asking. What must never happen is a *public*
 * page using the extension to read a *private* one, which is a tier it could not reach itself.
 *
 * That is the browser's own rule for ordinary pages — Private Network Access (formerly
 * CORS-RFC1918) — and the worker holding itself to the same tier check is the point: the fetch
 * happens outside the page, so nothing else would apply it.
 */
export function fetchRefusal(url: string, pageOrigin: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'That link is not a web address Piko can open.'
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Piko only opens http and https links.'
  }

  if (isPrivateAddress(parsed.hostname) && !isPrivateOrigin(pageOrigin)) {
    return 'Piko does not open links to addresses on your own network.'
  }

  if (isSensitiveUrl(url)) {
    return 'Piko does not open links to email, chat, password managers or sign-in pages.'
  }

  return null
}

/**
 * Which tier the page doing the dragging sits on. An origin that cannot be parsed is treated as
 * public, which is the answer that refuses more rather than less.
 */
function isPrivateOrigin(pageOrigin: string): boolean {
  try {
    return isPrivateAddress(new URL(pageOrigin).hostname)
  } catch {
    return false
  }
}
