import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Confidence, Recommendation, RecommendationSet } from '../api/types'
import { Icon } from './ui'
import styles from './Recommendations.module.css'

/**
 * What to work on next — Milestone 16.
 *
 * ## This component computes nothing
 *
 * Every figure, every sentence, every ordering arrives already decided by
 * `services/recommendationService.ts`, for the same reason the leaderboard page re-sorts
 * nothing: a second implementation is a second thing to disagree with the first. The
 * page's whole job is to render what it was given, in the order it was given.
 *
 * ## And it never claims more than the server did
 *
 * Two rules it holds to, both inherited from what Milestone 15 deleted:
 *
 * - **The evidence is shown, not hidden.** Each card can be expanded to the counts it
 *   was derived from. A recommendation the reader cannot check is indistinguishable
 *   from one that was invented, and this product shipped invented ones once.
 * - **How they were produced is stated in plain words.** `engine.basis` is printed
 *   verbatim, so nobody has to guess whether they are reading arithmetic or a model.
 *   The default engine says "No AI is involved", because none is.
 */

const CONFIDENCE_WORDS: Record<Confidence, string> = {
  low: 'Early signal',
  medium: 'Reasonably clear',
  high: 'Well established',
}

/** Machine-readable server notes → the sentence a reader needs. */
const NOTE_WORDS: Record<string, string> = {
  'nothing-submitted-yet': 'You have not submitted any questions yet, so there is nothing to work from.',
  'no-published-questions-for-your-class':
    'There are no published questions for your class yet, so there is nothing to point you at.',
  'no-topic-is-confidently-below-par': 'No topic is clearly below par on the answers you have given so far.',
  'no-topic-is-confidently-above-par': 'No topic has enough consistently correct answers to be called a strength yet.',
  'recommendations-unavailable': 'Recommendations could not be worked out just now.',
}

function noteFor(notes: string[], key: string): string | null {
  return notes.includes(key) ? (NOTE_WORDS[key] ?? null) : null
}

/**
 * One recommendation, with its evidence one click away.
 *
 * The basis is collapsed by default because five expanded cards is a spreadsheet, not
 * advice — but it is always present, never conditional on the numbers being flattering.
 */
function Card({ item, tone }: { item: Recommendation; tone: 'weak' | 'strong' | 'neutral' }) {
  const [showBasis, setShowBasis] = useState(false)
  const { basis } = item

  return (
    <li className={`${styles.card} ${styles[tone]}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{item.title}</span>
        <span className={styles.confidence} data-confidence={item.confidence}>
          {CONFIDENCE_WORDS[item.confidence]}
        </span>
      </div>

      <p className={styles.detail}>{item.detail}</p>

      <div className={styles.cardFoot}>
        {item.action && (
          <Link className={styles.action} to={item.action.href}>
            {item.action.label} <Icon name="ph-arrow-right" weight="bold" />
          </Link>
        )}
        <button type="button" className={styles.basisToggle} onClick={() => setShowBasis((open) => !open)}>
          {showBasis ? 'Hide the numbers' : 'Show the numbers'}
        </button>
      </div>

      {showBasis && (
        <dl className={styles.basis}>
          {basis.answered > 0 && (
            <>
              <dt>Answered</dt>
              <dd>{basis.answered}</dd>
              <dt>Correct</dt>
              <dd>{basis.correct}</dd>
              <dt>Accuracy</dt>
              {/* Null is "not measured", never 0% — the same rule the rest of the page keeps. */}
              <dd>{basis.accuracyPercent === null ? 'Not measured' : `${basis.accuracyPercent}%`}</dd>
            </>
          )}
          {basis.lowerBoundPercent !== null && basis.upperBoundPercent !== null && (
            <>
              <dt>Likely range</dt>
              <dd>
                {basis.lowerBoundPercent}% – {basis.upperBoundPercent}%
                <span className={styles.basisNote}>95% confidence, given how many you have answered</span>
              </dd>
            </>
          )}
          {Object.entries(basis.figures).map(([key, value]) => (
            <div key={key} className={styles.basisPair}>
              <dt>{humanise(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}

/** `availableQuestions` → `Available questions`. Keys are ours, so this stays simple. */
function humanise(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function Section({
  title,
  icon,
  items,
  tone,
  emptyMessage,
}: {
  title: string
  icon: string
  items: Recommendation[]
  tone: 'weak' | 'strong' | 'neutral'
  emptyMessage: string | null
}) {
  // A section with nothing to say and no reason to give would read as a broken panel,
  // so it is dropped entirely rather than rendered blank.
  if (items.length === 0 && !emptyMessage) return null

  return (
    <div className={styles.section}>
      <h4 className={styles.sectionTitle}>
        <Icon name={icon} weight="bold" /> {title}
      </h4>
      {items.length === 0 ? (
        <p className={styles.empty}>{emptyMessage}</p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <Card key={item.id} item={item} tone={tone} />
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Recommendations({ data }: { data: RecommendationSet }) {
  const { engine, notes } = data
  const nothingAtAll =
    data.weakTopics.length === 0 &&
    data.strongTopics.length === 0 &&
    data.difficulty.length === 0 &&
    data.practice.length === 0 &&
    data.insights.length === 0

  return (
    <div className="card">
      <div className={styles.head}>
        <h3>What to work on next</h3>
        {/*
          Printed verbatim from the server, and deliberately prominent. The engine is
          swappable; what produced a given set of recommendations should never be a
          guess, and nothing here is labelled AI unless a model really produced it.
        */}
        <span className={styles.engine} data-kind={engine.kind}>
          <Icon name={engine.kind === 'model' ? 'ph-brain' : 'ph-function'} weight="bold" />
          {engine.label}
        </span>
      </div>
      <p className={styles.basisLine}>{engine.basis}</p>

      {nothingAtAll ? (
        <p className={styles.empty}>
          {noteFor(notes, 'nothing-submitted-yet') ??
            noteFor(notes, 'no-published-questions-for-your-class') ??
            noteFor(notes, 'recommendations-unavailable') ??
            'There is not enough in your record yet to suggest anything specific.'}
        </p>
      ) : (
        <>
          <Section
            title="Work on these"
            icon="ph-target"
            items={data.weakTopics}
            tone="weak"
            emptyMessage={noteFor(notes, 'no-topic-is-confidently-below-par')}
          />
          <Section title="Where to practise" icon="ph-play-circle" items={data.practice} tone="neutral" emptyMessage={null} />
          <Section title="Difficulty" icon="ph-stairs" items={data.difficulty} tone="neutral" emptyMessage={null} />
          <Section
            title="Your strengths"
            icon="ph-medal"
            items={data.strongTopics}
            tone="strong"
            emptyMessage={noteFor(notes, 'no-topic-is-confidently-above-par')}
          />
          <Section title="Observations" icon="ph-magnifying-glass" items={data.insights} tone="neutral" emptyMessage={null} />
        </>
      )}

      {notes.some((note) => note.startsWith('topics-need-at-least')) && (
        <p className={styles.footnote}>
          A topic needs at least {data.minimumSample} answered questions before it can fairly be called a strength or a
          weakness, and a small sample is treated as the uncertain evidence it is.
        </p>
      )}
    </div>
  )
}
