import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * NFR-UX-05 (M8 stage 9) — "exports stay light". This is G1: a static
 * source-text guarantee that ReportSummaryView (and everything it imports
 * from within this codebase) never carries a `dark:` Tailwind variant.
 *
 * `.force-light` (index.css) only overrides token-driven classes
 * (bg-background, text-foreground, …) by re-declaring their CSS custom
 * properties on this subtree — it does nothing against a `dark:` utility,
 * which switches on the ancestor `.dark` class being present in the DOM,
 * not on any custom property. A single `dark:bg-slate-900` slipped into
 * this component or one of its local imports would render dark inside an
 * exported PDF/PNG or on `/r/:shareToken` even with `.force-light` present
 * and correctly applied — this test is what stops that from ever landing
 * silently, since nothing else in the stack (build, lint, the fast band's
 * ordinary rendering assertions) would catch it.
 */

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src',
)
const ENTRY = path.join(SRC_ROOT, 'components/shared/ReportSummaryView.jsx')

const IMPORT_RE = /import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g
const CANDIDATE_EXTENSIONS = ['', '.jsx', '.js', '/index.jsx', '/index.js']

/** Strips JS block (`/* ... *‍/`) and line (`// ...`) comments before the
 * `dark:` scan runs, so a doc comment explaining this very prohibition -
 * this file's own header, for one - can quote the literal token without
 * failing itself. The scan cares about code, not prose about code. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function resolveLocalImport(specifier, fromFile) {
  let basePath
  if (specifier.startsWith('@/')) {
    basePath = path.join(SRC_ROOT, specifier.slice(2))
  } else if (specifier.startsWith('.')) {
    basePath = path.resolve(path.dirname(fromFile), specifier)
  } else {
    return null // external package - not part of this codebase's own text
  }
  for (const ext of CANDIDATE_EXTENSIONS) {
    const candidate = basePath + ext
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Walks ReportSummaryView's own local (@/, relative) import graph and
 * returns { file, source } for every file reached, entry included. Never
 * descends into node_modules/external packages - the guarantee is about
 * code this project controls. */
function collectLocalSourceGraph(entryFile) {
  const visited = new Map()
  const stack = [entryFile]
  while (stack.length > 0) {
    const file = stack.pop()
    if (visited.has(file)) continue
    const source = readFileSync(file, 'utf-8')
    visited.set(file, source)
    for (const match of source.matchAll(IMPORT_RE)) {
      const resolved = resolveLocalImport(match[1], file)
      if (resolved && !visited.has(resolved)) stack.push(resolved)
    }
  }
  return visited
}

describe('ReportSummaryView stays pinned light (NFR-UX-05)', () => {
  const graph = collectLocalSourceGraph(ENTRY)

  it('walks a non-trivial import graph, so the scan below is not vacuous', () => {
    // Guards against the resolver silently finding nothing and the dark:
    // check below passing only because it never looked anywhere.
    expect(graph.size).toBeGreaterThan(1)
  })

  it('carries the force-light class on its own root element', () => {
    expect(graph.get(ENTRY)).toMatch(/force-light/)
  })

  for (const [file, source] of graph) {
    it(`contains no "dark:" token — ${path.relative(SRC_ROOT, file)}`, () => {
      expect(stripComments(source)).not.toMatch(/[\s"'`{]dark:/)
    })
  }
})
