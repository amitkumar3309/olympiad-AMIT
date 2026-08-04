import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import styles from './MathText.module.css'

/**
 * Renders author-written text that may contain LaTeX, safely.
 *
 * ## The safety property
 *
 * Question content is stored as plain text with LaTeX islands (`$...$` inline,
 * `$$...$$` display). This component splits that text into segments and treats the
 * two kinds completely differently:
 *
 *  - **Prose** is returned as a React text node. React escapes text nodes, so prose
 *    can never become markup no matter what an author typed. It never touches
 *    `dangerouslySetInnerHTML`.
 *  - **LaTeX** is compiled by KaTeX and only KaTeX's *own* output is inserted as
 *    HTML. KaTeX runs with `trust: false` (its default), which refuses `\href`,
 *    `\includegraphics` and every other command that could emit a link or a URL.
 *
 * So the only HTML on the page is HTML that KaTeX generated from a restricted
 * grammar. That is the whole argument, and it does not depend on sanitising
 * anything — the untrusted string never enters an HTML sink.
 *
 * The backend independently rejects the dangerous LaTeX commands at write time
 * (`backend/src/lib/mathContent.ts`), so this is defence in depth rather than the
 * only line. A `<script>` in a question cannot even be saved.
 *
 * ## Keeping the two parsers in step
 *
 * `parseSegments` below mirrors `parseMathSegments` in that backend module. Both are
 * a single left-to-right scan with no nesting, deliberately, so the pair can be
 * verified by reading them side by side. If one grows a special case, so must the
 * other — otherwise content passes validation on the server and renders differently
 * here.
 */

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'inline'; value: string }
  | { kind: 'display'; value: string }

function parseSegments(input: string): Segment[] {
  const segments: Segment[] = []
  let text = ''
  let index = 0

  const flushText = () => {
    if (text.length > 0) {
      segments.push({ kind: 'text', value: text })
      text = ''
    }
  }

  while (index < input.length) {
    const char = input[index]

    // An escaped dollar is a literal dollar sign, not a delimiter.
    if (char === '\\' && input[index + 1] === '$') {
      text += '$'
      index += 2
      continue
    }

    if (char !== '$') {
      text += char
      index += 1
      continue
    }

    const isDisplay = input[index + 1] === '$'
    const openLength = isDisplay ? 2 : 1
    const closeToken = isDisplay ? '$$' : '$'
    const searchFrom = index + openLength

    let cursor = searchFrom
    let closeAt = -1
    while (cursor < input.length) {
      if (input[cursor] === '\\' && input[cursor + 1] === '$') {
        cursor += 2
        continue
      }
      if (input.startsWith(closeToken, cursor)) {
        closeAt = cursor
        break
      }
      cursor += 1
    }

    // Unclosed delimiters cannot be saved through the API, but a draft being typed
    // into the editor is unbalanced most of the time. Showing the rest as literal
    // text is what makes the live preview usable while typing.
    if (closeAt === -1) {
      text += input.slice(index)
      break
    }

    flushText()
    segments.push({ kind: isDisplay ? 'display' : 'inline', value: input.slice(searchFrom, closeAt) })
    index = closeAt + openLength
  }

  flushText()
  return segments
}

interface RenderedSegment {
  kind: Segment['kind']
  /** KaTeX-generated HTML for math segments; the literal string for text. */
  value: string
  failed?: boolean
}

function renderSegments(input: string): RenderedSegment[] {
  return parseSegments(input).map((segment) => {
    if (segment.kind === 'text') return { kind: 'text' as const, value: segment.value }

    try {
      return {
        kind: segment.kind,
        value: katex.renderToString(segment.value, {
          displayMode: segment.kind === 'display',
          // `throwOnError: false` would silently render the error text as math.
          // Throwing lets us show the author their broken source instead, which is
          // far more useful in an editor preview.
          throwOnError: true,
          // Explicit even though it is the default: this is the flag that refuses
          // \href, \url and \includegraphics. It must never become true.
          trust: false,
          strict: false,
          output: 'html',
        }),
      }
    } catch {
      // Invalid LaTeX falls back to the raw source, marked up as an error. The
      // source is rendered as a React text node below, so this path is no less
      // safe than the success path.
      return { kind: segment.kind, value: segment.value, failed: true }
    }
  })
}

export interface MathTextProps {
  children: string
  /** Renders in a `<div>` rather than a `<span>`, for multi-line content. */
  block?: boolean
  className?: string
}

export default function MathText({ children, block = false, className }: MathTextProps) {
  const segments = useMemo(() => renderSegments(children ?? ''), [children])
  const Wrapper = block ? 'div' : 'span'

  return (
    <Wrapper className={[styles.root, className].filter(Boolean).join(' ')}>
      {segments.map((segment, index) => {
        // Plain prose: a React text node, so it is escaped and can never be markup.
        if (segment.kind === 'text') {
          return <span key={index}>{segment.value}</span>
        }
        if (segment.failed) {
          return (
            <code key={index} className={styles.invalid} title="This expression could not be rendered">
              ${segment.value}$
            </code>
          )
        }
        // Only KaTeX's own output reaches this sink, never the author's string.
        return (
          <span
            key={index}
            className={segment.kind === 'display' ? styles.display : styles.inline}
            dangerouslySetInnerHTML={{ __html: segment.value }}
          />
        )
      })}
    </Wrapper>
  )
}
