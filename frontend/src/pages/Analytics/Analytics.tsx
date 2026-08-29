import { useCallback, useEffect, useState } from 'react'
import StudentShell from '../../components/StudentShell'
import ChartCard from '../../components/ChartCard'
import Recommendations from '../../components/Recommendations'
import {
  Alert,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  SkeletonCards,
  StatTile,
  Table,
  TableScroll,
} from '../../components/ui'
import { api } from '../../api/client'
import { humanizeError } from '../../lib/errors'
import { useAuth } from '../../context/AuthContext'
import {
  SURFACE_LABELS,
  type AnalyticsResponse,
  type AreaRow,
  type NamedPerformanceRow,
  type PerformanceRow,
  type RecommendationSet,
  type RecommendationsResponse,
} from '../../api/types'
import styles from './Analytics.module.css'

/**
 * Performance analytics — real, and derived from the student's own answered questions.
 *
 * ## The two things this page used to be
 *
 * It **invented** everything: 88% accuracy over 450 questions, a rising learning curve,
 * four topic breakdowns and "you are in the top 5% of all national Olympiad
 * participants", shown to every student as their own measured performance. Deleted in
 * the Milestone 5 follow-up.
 *
 * Then it was **honestly empty**, because the only real figure available was XP per
 * day, and everything else needed answered questions that nothing recorded. Milestone
 * 15 makes the rest real: four collections now hold graded answers, and the server
 * derives accuracy, topic/subject/difficulty breakdowns, trends and weak/strong areas
 * from them on every read.
 *
 * ## What this component is careful about
 *
 * **It computes nothing.** Every percentage arrives already decided by
 * `services/analyticsService.ts`, for the same reason the leaderboard page re-sorts
 * nothing: a second implementation is a second thing to disagree with the first.
 *
 * **`null` is rendered as "not measured", never as `0%`.** The API distinguishes "has
 * answered nothing here" from "answered, and got none right", and collapsing the two
 * in the UI would throw away the honesty the backend went to trouble to preserve.
 *
 * ## Recommendations are fetched separately, on purpose (Milestone 16)
 *
 * They come from a swappable engine, and a model-backed one would have latency the
 * arithmetic does not. Loading them alongside rather than inside the analytics request
 * means the figures paint as soon as they arrive and the advice panel fills when it is
 * ready — a slow engine costs one panel rather than the whole page. A failure there is
 * likewise contained: `recommendationError` is shown in place of the panel, and the
 * measurements below it are unaffected.
 */
export default function Analytics() {
  const { state } = useAuth()
  const [result, setResult] = useState<AnalyticsResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [recommendations, setRecommendations] = useState<RecommendationSet | null>(null)
  const [recommendationError, setRecommendationError] = useState('')

  /**
   * Extracted from the effect so the error state can offer a retry that actually
   * retries. Both requests are issued together and settle independently — see the note
   * above on why the advice is a separate call.
   */
  const load = useCallback(() => {
    if (state.status !== 'student') return
    const { studentId } = state.student
    setError(null)
    setRecommendationError('')

    api
      .get<AnalyticsResponse>(`/analytics/${studentId}`)
      .then(setResult)
      .catch(setError)

    api
      .get<RecommendationsResponse>(`/analytics/${studentId}/recommendations`)
      .then((res) => setRecommendations(res.recommendations))
      .catch((err) =>
        setRecommendationError(
          humanizeError(err, { fallback: 'Could not work out your recommendations.' }),
        ),
      )
  }, [state])

  useEffect(() => {
    load()
  }, [load])

  const analytics = result?.analytics ?? null
  const xpByDay = result?.xpByDay ?? []
  const totalXp = xpByDay.reduce((sum, point) => sum + point.xp, 0)

  /** `2026-08-10` → `10 Aug`, for a readable axis. */
  function shortDay(day: string): string {
    const parsed = new Date(`${day}T00:00:00Z`)
    return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }

  /** The one place a null percentage becomes text, so it cannot read as zero. */
  function pct(value: number | null): string {
    return value === null ? '—' : `${value}%`
  }

  function BreakdownTable({ title, rows }: { title: string; rows: NamedPerformanceRow[] }) {
    if (rows.length === 0) return null
    return (
      <Card>
        <CardHeader title={title} size="sm" as="h2" />
        <TableScroll label={title}>
          <Table density="compact">
            <thead>
              <tr>
                <th>Chapter</th>
                <th>Answered</th>
                <th>Correct</th>
                <th>Accuracy</th>
                <th>Marks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}

                  </td>
                  <td>{row.answered}</td>
                  <td>{row.correct}</td>
                  <td>
                    <AccuracyBar value={row.accuracyPercent} />
                  </td>
                  <td className={styles.muted}>
                    {row.marksAwarded} / {row.marksAvailable}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableScroll>
      </Card>
    )
  }

  /** A bar whose width is the accuracy, or an em dash when there is nothing to show. */
  function AccuracyBar({ value }: { value: number | null }) {
    if (value === null) return <span className={styles.muted}>Not measured</span>
    return (
      <span className={styles.barWrap}>
        <span className={styles.bar} style={{ width: `${value}%` }} data-low={value < 50 ? 'true' : undefined} />
        <span className={styles.barLabel}>{value}%</span>
      </span>
    )
  }

  function AreaList({ title, areas, tone }: { title: string; areas: AreaRow[]; tone: 'strong' | 'weak' }) {
    return (
      <Card>
        <CardHeader title={title} size="sm" as="h2" />
        {areas.length === 0 ? (
          <p className={styles.muted}>
            {/* Two different reasons for an empty list, and saying the wrong one is
                its own small dishonesty: too little evidence to judge, versus judged
                and found to be neither. */}
            Nothing here yet — an area needs at least {analytics?.minimumAreaSample ?? 5} answered questions, and{' '}
            {tone === 'strong'
              ? `an accuracy of ${analytics?.strongAreaMinAccuracy ?? 70}% or better, to count as a strength.`
              : `an accuracy of ${analytics?.weakAreaMaxAccuracy ?? 50}% or below, to count as a weakness.`}
          </p>
        ) : (
          <ul className={styles.areaList}>
            {areas.map((area) => (
              <li key={`${area.scope}:${area.id}`} className={tone === 'weak' ? styles.weak : styles.strong}>
                <span className={styles.areaName}>
                  {area.name}
                  <span className={styles.scope}>{area.scope}</span>
                </span>
                <span className={styles.areaFigure}>
                  {area.accuracyPercent}% <span className={styles.muted}>of {area.answered}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    )
  }

  function SurfaceRow({ row }: { row: PerformanceRow & { surface: keyof typeof SURFACE_LABELS; attempts: number } }) {
    return (
      <tr>
        <td>{SURFACE_LABELS[row.surface]}</td>
        <td>{row.attempts}</td>
        <td>{row.answered}</td>
        <td>
          <AccuracyBar value={row.accuracyPercent} />
        </td>
      </tr>
    )
  }

  return (
    <StudentShell title="Performance Analysis" subtitle="Worked out from the questions you have actually answered">
      <div className={styles.wrap}>
        {error !== null && <ErrorState error={error} titleAs="h2" onRetry={load} />}
        {!result && error === null && <SkeletonCards count={4} label="Working out your performance" />}

        {analytics && !analytics.hasData && (
          <Card>
            {/* `titleAs="h2"`: this state IS the page, sitting under the h1 with no
                section heading between, so an h3 would skip a level. */}
            <EmptyState
              icon="ph-chart-line"
              titleAs="h2"
              title="Nothing to measure yet"
              description="Your accuracy, strongest and weakest chapters and progress over time are all worked out from questions you have answered — and you have not submitted anything yet. This page fills in by itself once you do."
              action={
                <ButtonLink to="/practice" icon="ph-target">
                  Start practising
                </ButtonLink>
              }
              secondaryAction={
                <ButtonLink to="/daily-challenge" variant="secondary" icon="ph-dice-five">
                  Today’s challenge
                </ButtonLink>
              }
            />
            <p className={styles.pendingNote}>
              We would rather show you nothing than a made-up number, so none of these panels are filled with samples.
            </p>
          </Card>
        )}

        {/* ------------------------------------------------------------
            What to do next. Above the measurements for a student who has
            some, below the "nothing yet" card for one who has none — in
            both cases the first actionable thing on the page.
        ------------------------------------------------------------ */}
        {recommendationError && !recommendations && (
          <Card>
            <CardHeader title="What to work on next" size="sm" as="h2" />
            <Alert tone="danger">{recommendationError}</Alert>
          </Card>
        )}
        {recommendations && <Recommendations data={recommendations} />}

        {analytics?.hasData && (
          <>
            {/* ----------------------------------------------------------
                Headline: accuracy, volume, pace
            ---------------------------------------------------------- */}
            <div className={styles.statRow}>
              <StatTile icon="ph-target" value={pct(analytics.overall.accuracyPercent)} label="Overall accuracy" />
              <StatTile icon="ph-list-checks" value={analytics.overall.answered} label="Questions answered" />
              <StatTile icon="ph-exam" value={analytics.overall.attempts} label="Sittings submitted" />
              <StatTile
                icon="ph-timer"
                value={
                  analytics.overall.averageSecondsPerQuestion === null
                    ? '—'
                    : `${analytics.overall.averageSecondsPerQuestion}s`
                }
                label="Avg seconds / question"
              />
            </div>

            {/* ----------------------------------------------------------
                Strengths and weaknesses
            ---------------------------------------------------------- */}
            <div className={styles.chartRow}>
              <AreaList title="Strong areas" areas={analytics.strongAreas} tone="strong" />
              <AreaList title="Weak areas" areas={analytics.weakAreas} tone="weak" />
            </div>

            {/* ----------------------------------------------------------
                Trends
            ---------------------------------------------------------- */}
            <div className={styles.chartRow}>
              {analytics.accuracyByDay.length > 1 && (
                <ChartCard
                  title="Accuracy over time"
                  type="line"
                  label="Accuracy %"
                  labels={analytics.accuracyByDay.map((point) => shortDay(point.day))}
                  data={analytics.accuracyByDay.map((point) => point.accuracyPercent ?? 0)}
                />
              )}
              {analytics.progressTrend.length > 1 && (
                <ChartCard
                  title="Score per sitting"
                  type="line"
                  label="Score %"
                  tone="info"
                  labels={analytics.progressTrend.map((point) => point.label)}
                  data={analytics.progressTrend.map((point) => point.scorePercent ?? 0)}
                />
              )}
            </div>

            {analytics.paceTrend.length > 1 && (
              <div className={styles.chartRow}>
                <ChartCard
                  title="Seconds per question, per sitting"
                  type="line"
                  label="Seconds"
                  tone="success"
                  labels={analytics.paceTrend.map((point) => point.label)}
                  data={analytics.paceTrend.map((point) => point.secondsPerQuestion)}
                />
              </div>
            )}

            {/* ----------------------------------------------------------
                Breakdowns
            ---------------------------------------------------------- */}
            <Card>
              <CardHeader title="By difficulty" size="sm" as="h2" />
              <TableScroll label="Accuracy by difficulty">
                <Table density="compact">
                  <thead>
                    <tr>
                      <th>Difficulty</th>
                      <th>Answered</th>
                      <th>Correct</th>
                      <th>Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.byDifficulty.map((row) => (
                      <tr key={row.difficulty}>
                        <td>{row.difficulty}</td>
                        <td>{row.answered}</td>
                        <td>{row.correct}</td>
                        <td>
                          <AccuracyBar value={row.accuracyPercent} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            </Card>

            {/*
              Chapters only.

              The "By subject" table used to sit beside this one and, with a single implicit subject,
              it was the *same numbers* as the overall figures at the top of the page under a heading
              that made them look like a different measurement. The API still returns `bySubject` —
              the analytics service groups by it and nothing about that changed — the page simply has
              no reason to draw it.
            */}
            <BreakdownTable title="By chapter" rows={analytics.byTopic} />

            <Card>
              <CardHeader title="Where your answers came from" size="sm" as="h2" />
              <TableScroll label="Accuracy by where the questions were answered">
                <Table density="compact">
                  <thead>
                    <tr>
                      <th>Surface</th>
                      <th>Sittings</th>
                      <th>Answered</th>
                      <th>Accuracy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.bySurface.map((row) => (
                      <SurfaceRow key={row.surface} row={row} />
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
              {analytics.notes.includes('pace-unavailable-daily-challenge-has-no-clock') && (
                <p className={styles.muted}>
                  The daily challenge is not timed, so it counts toward your accuracy but not toward your pace.
                </p>
              )}
              {analytics.notes.includes('some-answered-questions-have-since-been-deleted') && (
                <p className={styles.muted}>
                  Some questions you answered have since been removed from the bank, so they count toward your totals
                  but no longer appear under a topic.
                </p>
              )}
            </Card>
          </>
        )}

        {/* ------------------------------------------------------------
            Participation, which measures something different from ability
        ------------------------------------------------------------ */}
        {result && xpByDay.length > 0 && (
          <>
            <div className={styles.statRow}>
              <StatTile icon="ph-star" value={totalXp} label="XP earned (last 30 days)" />
              <StatTile icon="ph-calendar-check" value={xpByDay.length} label="Active days (last 30)" />
              <StatTile icon="ph-trend-up" value={Math.max(...xpByDay.map((p) => p.xp))} label="Best day (XP)" />
            </div>
            <div className={styles.chartRow}>
              <ChartCard
                title="XP earned per day"
                type="line"
                label="XP"
                labels={xpByDay.map((p) => shortDay(p.day))}
                data={xpByDay.map((p) => p.xp)}
              />
            </div>
          </>
        )}
      </div>
    </StudentShell>
  )
}
