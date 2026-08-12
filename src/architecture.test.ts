/**
 * The one import boundary worth checking mechanically: content/ and background/ are two
 * different bundles, running in two different security contexts (an untrusted page vs the
 * extension's own worker), and "the content script decides nothing" — already an invariant
 * of `content/state/previewState.ts` — depends on nothing in `content/` ever importing a
 * background decision function directly, bypassing the message contract in `shared/messages.ts`.
 *
 * Parsed with the TypeScript compiler rather than a regex over import lines, so a wrapped
 * multi-line import or an unusual filename can't go unseen the way a line-oriented reader would
 * miss it.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname)

const sourceFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(path)
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.test.ts')) return []
    return [path]
  })

const importSpecifiersOf = (file: string): string[] => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    const specifier =
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
        ? node.moduleSpecifier
        : undefined
    if (specifier && ts.isStringLiteral(specifier)) specifiers.push(specifier.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return specifiers
}

const crossings = (from: string, into: string): string[] =>
  sourceFilesUnder(join(SRC, from)).flatMap((file) =>
    importSpecifiersOf(file)
      .filter((spec) => spec.includes(`/${into}/`))
      .map((spec) => `${relative(SRC, file)} imports '${spec}'`),
  )

describe('the content/background boundary', () => {
  it('never lets the content script import a background decision directly', () => {
    expect(crossings('content', 'background')).toEqual([])
  })

  it('never lets the background worker import from the content script', () => {
    expect(crossings('background', 'content')).toEqual([])
  })
})
