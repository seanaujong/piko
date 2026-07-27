/**
 * Hosts Piko refuses to touch, in both directions.
 *
 * Piko holds access to every site, so the question a reader actually asks — "is this thing
 * reading my bank?" — deserves an answer stronger than "it only acts on a gesture." This is
 * that answer for the categories where it can be given honestly.
 *
 * **The list only contains categories that terminate.** Webmail, password managers, chat and
 * single-sign-on endpoints are a bounded set: a handful of hosts covers nearly every session
 * worth protecting. Banking is not bounded — there are tens of thousands of institutions, and
 * any list of them is a token that reads as coverage while providing almost none. So banking is
 * deliberately absent, and the claim made in `docs/chrome-web-store-listing.md` is the narrow
 * one this list can support. A reader who wants their own bank excluded needs the user-managed
 * list, not a guess baked into a release.
 *
 * **Two directions, one predicate.** A host is sensitive whether Piko would *run* on it (the
 * content script, kept out by the manifest's `exclude_matches`) or merely *fetch* it (the
 * background worker, which `exclude_matches` does not reach at all — see `fetchPolicy.ts`).
 * Those are different mechanisms enforced in different processes, so the list lives here, above
 * both, and `manifest.exclude_matches` is asserted against it by `sensitiveHosts.test.ts`
 * rather than maintained beside it. A list that can drift from its own manifest is not a rule.
 */

/**
 * Registrable domains, not URLs — subdomains are covered by the patterns derived below, so
 * `google.com` would exclude the whole of Google rather than its account pages. Each entry is
 * as narrow as the category allows.
 */
export const SENSITIVE_HOSTS: readonly string[] = [
  // Single sign-on. The highest value per entry in the list: most sensitive sessions in a
  // browser begin at one of a very small number of these.
  'accounts.google.com',
  'login.microsoftonline.com',
  'appleid.apple.com',
  'okta.com',
  'auth0.com',
  'id.atlassian.com',

  // Webmail.
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.yahoo.com',
  'mail.proton.me',
  'app.fastmail.com',
  'mail.zoho.com',

  // Password and secret managers.
  '1password.com',
  'bitwarden.com',
  'lastpass.com',
  'dashlane.com',
  'keepersecurity.com',

  // Messaging read in a tab.
  'web.whatsapp.com',
  'messages.google.com',
  'web.telegram.org',
  'discord.com',
  'slack.com',
  'teams.microsoft.com',
]

/**
 * Chrome match patterns for the manifest's `exclude_matches`.
 *
 * Both forms are emitted per host. Whether `*://*.example.com/*` also matches the bare
 * `example.com` is a detail of Chrome's pattern semantics that this project would otherwise be
 * betting on silently; emitting `*://example.com/*` alongside it makes the question moot, at
 * the cost of a longer array nobody reads by hand.
 */
export function excludeMatchPatterns(hosts: readonly string[] = SENSITIVE_HOSTS): string[] {
  return hosts.flatMap((host) => [`*://${host}/*`, `*://*.${host}/*`])
}

/**
 * Mirrors the match patterns above: a host matches if it *is* one of the entries or sits
 * beneath one. Suffix matching is anchored on a dot so that `notbitwarden.com` cannot pass for
 * `bitwarden.com` — the check a bare `endsWith` gets wrong.
 */
export function isSensitiveUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return false // not a URL this predicate can judge; fetchPolicy rejects it on other grounds
  }
  return SENSITIVE_HOSTS.some((entry) => host === entry || host.endsWith(`.${entry}`))
}
