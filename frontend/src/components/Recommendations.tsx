import { Link } from 'react-router-dom'
import type { Recommendation, RecommendationSet } from '../api/types'
import { Icon } from './ui'
import styles from './Recommendations.module.css'

/**
 * What to work on next — Milestone 16, trimmed on 2026-10-11 (owner: "show only what is important
 * and needed for a student").
 *
 * A student sees three things, each only when there is something in it: the topics to work on,
 * where to practise, and their strengths. Each card is a title, one line, its action, and the
 * counts it rests on ("6 of 10 correct") — the evidence stays, in one short line rather than an
 * expandable table. The method badge, the confidence labels, the difficulty advice and the
 * observations about how a student's sittings are spread were removed: true, but not something
 * a child acts on.
 *
 * ## This component still computes nothing
 *
 * Every sentence and every ordering arrives decided by `services/recommendationService.ts`; the
 * page renders what it was given, in the order it was given. Nothing here is labelled AI — the
 * engine is statistical, and the page simply no longer describes its method.
 */

/** "6 of 10 correct" — the counts a card was worked out from, or nothing when it rests on none. */
function evidenceOf(item: Recommendation): string | null {
  const { answered, correct } = item.basis
  return answered > 0 ? `${correct} of ${answered} correct` : null
}

function Group({ title, icon, items, tone }: { title: string; icon: string; items: Recommendation[]; tone: 'weak' | 'strong' | 'neutral' }) {
  if (items.length === 0) return null
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>
        <Icon name={icon} weight="bold" /> {title}
      </h3>
      <ul className={styles.list}>
        {items.map((item) => {
          const evidence = evidenceOf(item)
          return (
            <li key={item.id} className={`${styles.card} ${styles[tone]}`}>
              <span className={styles.cardTitle}>{item.title}</span>
              <p className={styles.detail}>{item.detail}</p>
              {(evidence || item.action) && (
                <div className={styles.cardFoot}>
                  {evidence && <span className={styles.evidence}>{evidence}</span>}
                  {item.action && (
                    <Link className={styles.action} to={item.action.href}>
                      {item.action.label} <Icon name="ph-arrow-right" weight="bold" />
                    </Link>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function Recommendations({ data }: { data: RecommendationSet }) {
  const { notes } = data
  const nothing = data.weakTopics.length === 0 && data.strongTopics.length === 0 && data.practice.length === 0

  return (
    <div className="card">
      {/* h2: a top-level section of the page that hosts it, under the h1. */}
      <h2 className={styles.title}>What to work on next</h2>

      {nothing ? (
        <p className={styles.empty}>
          {notes.includes('nothing-submitted-yet')
            ? 'Finish a practice test and your suggestions will appear here.'
            : notes.includes('no-published-questions-for-your-class')
              ? 'There are no practice questions for your class yet.'
              : notes.includes('recommendations-unavailable')
                ? 'Suggestions could not be worked out just now.'
                : `Keep practising. A topic appears here once you have answered at least ${data.minimumSample} questions in it.`}
        </p>
      ) : (
        <>
          <Group title="Work on these" icon="ph-target" items={data.weakTopics} tone="weak" />
          <Group title="Where to practise" icon="ph-play-circle" items={data.practice} tone="neutral" />
          <Group title="Your strengths" icon="ph-medal" items={data.strongTopics} tone="strong" />
        </>
      )}
    </div>
  )
}
