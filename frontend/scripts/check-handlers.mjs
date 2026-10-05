// Fails the lint step on a dead control in shipped code (Milestone 30, Phase 5 — brief §9).
//
//   npm run lint        # oxlint, then this
//
// oxlint's jsx-a11y rules catch `href="#"` and `javascript:` links; this catches what no
// rule does — a handler that does nothing (`onClick={() => {}}`, `() => undefined`,
// `() => null`, `() => void 0`, a `noop`) — and repeats the link checks for any spelling
// the rules might miss. A control that does nothing is a dead end however it is written.
// Development-only pages are scanned too: they ship in the source if not in the bundle.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../src', import.meta.url))

const CHECKS = [
  {
    pattern: /\bon[A-Z][A-Za-z]*=\{\s*\(\s*\)\s*=>\s*(\{\s*\}|undefined|null|void 0)\s*\}/,
    problem: 'a handler that does nothing',
  },
  { pattern: /\bon[A-Z][A-Za-z]*=\{\s*noop\s*\}/, problem: 'a handler that does nothing' },
  { pattern: /\bhref=\{?\s*["'`]#["'`]\s*\}?/, problem: 'a link to "#"' },
  { pattern: /\bhref=\{?\s*["'`]javascript:/i, problem: 'a javascript: link' },
]

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* files(path)
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) yield path
  }
}

const problems = []
for (const file of files(root)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const { pattern, problem } of CHECKS) {
      if (pattern.test(line)) problems.push(`${relative(process.cwd(), file)}:${index + 1}  ${problem}: ${line.trim()}`)
    }
  })
}

if (problems.length > 0) {
  console.error(`\n${problems.length} dead control(s) — every link must go somewhere and every handler must do something:\n`)
  for (const line of problems) console.error(`  ${line}`)
  process.exit(1)
}
console.log('✓ No dead links or no-op handlers.')
