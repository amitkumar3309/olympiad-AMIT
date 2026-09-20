import { useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import type { PlatformAnalytics } from '../../api/types'
import AdminShell from './AdminShell'
import ChartCard from '../../components/ChartCard'
import {
  Alert,
  Card,
  Field,
  Section,
  Select,
  SkeletonCards,
  StatTile,
  Table,
  TableScroll,
  TabPanel,
  Tabs,
} from '../../components/ui'
import styles from './Analytics.module.css'

/** `2026-08-10` → `10 Aug`, for a readable chart axis. */
function shortDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/**
 * Platform analytics.
 *
 * ## Every figure is counted from a collection
 *
 * Where nothing has happened it shows a zero, and where an average genuinely cannot be
 * produced it shows an em dash — "no papers have been sat" and "everybody scored zero"
 * are different facts, and a 0% states the second. Nothing here is estimated.
 *
 * ## Why this page was restructured (Milestone 26)
 *
 * It rendered **twenty-two stat tiles in six flat rows**, every one the same size and
 * the same weight, under six identical headings. That is a page with no answer to
 * "what do I need to know?" — the count of deactivated accounts had exactly as much
 * presence as the number of entrants, so a reader had to read all of it to find any of
 * it.
 *
 * No figure was removed and none changed. What changed is the hierarchy:
 *
 *  - **Four headline figures**, which are the ones somebody opens this page for.
 *  - **The two trends**, which are what those four are doing over time.
 *  - **The other eighteen behind tabs** — still one click away, no longer competing.
 *    `Tabs` in `mode="tabs"` with a `TabPanel` each, which is the ARIA pattern; the
 *    panels unmount when inactive, so a chart is never measured at zero width.
 */

type DetailTab = 'accounts' | 'content' | 'assessment' | 'xp' | 'classes'

const DETAIL_TABS: Array<{ id: DetailTab; label: string; icon: string }> = [
  { id: 'accounts', label: 'Accounts', icon: 'ph-users' },
  { id: 'content', label: 'Content', icon: 'ph-list-checks' },
  { id: 'assessment', label: 'Assessment', icon: 'ph-exam' },
  { id: 'xp', label: 'XP', icon: 'ph-lightning' },
  { id: 'classes', label: 'By class', icon: 'ph-student' },
]

export default function Analytics() {
  const [days, setDays] = useState(30)
  const [tab, setTab] = useState<DetailTab>('accounts')
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    api
      .get<{ analytics: PlatformAnalytics }>(`/admin/analytics?days=${days}`)
      .then((res) => {
        if (!cancelled) setAnalytics(res.analytics)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load analytics.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [days])

  /* The window picker is part of the page, not part of the data, so it stays mounted
     through loading and error — changing it is how a reader recovers from either. */
  const windowPicker = (
    <Field label="Window" id="a-days" hideLabel>
      <Select value={days} onChange={(e) => setDays(Number(e.target.value))}>
        <option value={7}>Last 7 days</option>
        <option value={30}>Last 30 days</option>
        <option value={90}>Last 90 days</option>
      </Select>
    </Field>
  )

  if (loading) {
    return (
      <AdminShell title="Analytics" actions={windowPicker}>
        {/* A skeleton in the shape of the page rather than a spinner: the reader sees
            where the four headline figures will be, so nothing jumps when they land.
            `SkeletonCards` carries the one polite live region — the shapes themselves
            are `aria-hidden`, or a screen reader is read a dozen empty boxes. */}
        <SkeletonCards count={4} label="Counting the platform figures" />
      </AdminShell>
    )
  }

  if (error) {
    return (
      <AdminShell title="Analytics" actions={windowPicker}>
        <Alert tone="danger" title="Could not load analytics">
          {error}
        </Alert>
      </AdminShell>
    )
  }

  if (!analytics) return null

  const { accounts, engagement, content, assessment, xp, byClass } = analytics
  const maxClassStudents = Math.max(1, ...byClass.map((row) => row.students))

  return (
    <AdminShell
      title="Analytics"
      subtitle={`Every figure counted from a collection, ${new Date(analytics.generatedAt).toLocaleString()}`}
      actions={windowPicker}
    >
      {/*
        The four figures this page is opened for. Everything below is context for
        these — which is why they are the only things at this size.
      */}
      <div className={styles.headlineRow}>
        <StatTile icon="ph-users" value={accounts.total} label="Entrants registered" />
        <StatTile icon="ph-pulse" value={engagement.activeLast7} label="Active in the last 7 days" tone="success" />
        <StatTile
          icon="ph-list-checks"
          value={content.questionsPublished}
          label="Questions published"
          hint={`of ${content.questionsTotal} written`}
        />
        <StatTile icon="ph-exam" value={assessment.mockAttemptsSubmitted} label="Mock papers sat" />
      </div>

      <Section
        eyebrow="Trend"
        eyebrowIcon="ph-chart-line-up"
        title="Registrations and activity"
        size="compact"
        className={styles.block}
      >
        <div className={styles.chartRow}>
          <ChartCard
            title={`New registrations per day (last ${days} days)`}
            type="bar"
            label="Registrations"
            tone="primary"
            labels={engagement.registrationsByDay.map((p) => shortDay(p.day))}
            data={engagement.registrationsByDay.map((p) => p.count)}
          />
          <ChartCard
            title={`Active students per day (last ${days} days)`}
            type="line"
            label="Active students"
            tone="success"
            labels={engagement.activeStudentsByDay.map((p) => shortDay(p.day))}
            data={engagement.activeStudentsByDay.map((p) => p.count)}
          />
        </div>
      </Section>

      <Section
        eyebrow="Detail"
        eyebrowIcon="ph-table"
        title="Everything else"
        lead="The same figures as before, grouped. Nothing here is estimated — where a count cannot be produced it shows a dash rather than a zero."
        size="compact"
        className={styles.block}
      >
        <Tabs
          items={DETAIL_TABS}
          value={tab}
          onChange={(id) => setTab(id as DetailTab)}
          label="Analytics detail"
          idPrefix="analytics-detail"
          variant="pill"
        />

        <TabPanel id="accounts" idPrefix="analytics-detail" active={tab === 'accounts'}>
          <div className={styles.statGrid}>
            <StatTile icon="ph-seal-check" value={accounts.verified} label="Email verified" />
            <StatTile icon="ph-hourglass" value={accounts.unverified} label="Awaiting verification" />
            <StatTile icon="ph-shield-check" value={accounts.admins} label="Administrators" />
            <StatTile icon="ph-check-circle" value={accounts.active} label="Active" />
            <StatTile
              icon="ph-pause-circle"
              value={accounts.suspended}
              label="Suspended"
              tone={accounts.suspended > 0 ? 'warning' : 'neutral'}
            />
            <StatTile
              icon="ph-prohibit"
              value={accounts.blocked}
              label="Blocked"
              tone={accounts.blocked > 0 ? 'danger' : 'neutral'}
            />
            <StatTile icon="ph-archive" value={accounts.deactivated} label="Deactivated" />
            <StatTile icon="ph-calendar" value={engagement.activeLast30} label="Active (30 days)" />
          </div>
        </TabPanel>

        <TabPanel id="content" idPrefix="analytics-detail" active={tab === 'content'}>
          <div className={styles.statGrid}>
            <StatTile
              icon="ph-list-checks"
              value={content.questionsPublished}
              label="Questions published"
              hint={`of ${content.questionsTotal} written`}
            />
            <StatTile
              icon="ph-exam"
              value={content.mockTestsPublished}
              label="Mock tests published"
              hint={`of ${content.mockTestsTotal} authored`}
            />
            <StatTile icon="ph-images" value={content.galleryPublished} label="Gallery photos" />
            <StatTile icon="ph-megaphone" value={content.announcementsPublished} label="Announcements live" />
          </div>
        </TabPanel>

        <TabPanel id="assessment" idPrefix="analytics-detail" active={tab === 'assessment'}>
          <div className={styles.statGrid}>
            <StatTile icon="ph-notebook" value={assessment.practiceSessionsSubmitted} label="Practice sessions submitted" />
            <StatTile icon="ph-exam" value={assessment.mockAttemptsSubmitted} label="Mock papers sat" />
            {/*
              `null`, not a string. `StatTile` renders an em dash for it — "no paper has
              been submitted" and "everybody scored zero" are different facts about a
              cohort, and a 0% states the second.
            */}
            <StatTile
              icon="ph-percent"
              value={assessment.mockAveragePercent === null ? null : `${assessment.mockAveragePercent}%`}
              label="Mean mock score"
              hint={assessment.mockAveragePercent === null ? 'No paper submitted yet' : undefined}
            />
            <StatTile
              icon="ph-dice-five"
              value={assessment.dailyChallengeCorrect}
              label="Daily challenges correct"
              hint={`of ${assessment.dailyChallengeAttempts} answered`}
            />
          </div>

          {/*
            Corrected in Milestone 26. This note read "the official exam is not built,
            and nothing writes to its collections" — which stopped being true in
            Milestone 13, when `Exam`, `ExamAttempt` and `Result` all became real and
            written by routes. An admin page asserting that a feature does not exist
            while it does is the same class of defect as a figure nobody can query.
          */}
          <p className={styles.note}>
            These four come from <strong>mock tests, practice sessions and daily challenges</strong>. The
            official Olympiad has its own results and certificates, reported on their own consoles rather than
            mixed in here — a rehearsal and a sitting are not comparable numbers.
          </p>
        </TabPanel>

        <TabPanel id="xp" idPrefix="analytics-detail" active={tab === 'xp'}>
          <div className={styles.statGrid}>
            <StatTile icon="ph-lightning" value={xp.awardedTotal} label="Total XP awarded" />
            <StatTile icon="ph-user-focus" value={xp.earners} label="Students with XP" />
            <StatTile icon="ph-chart-line" value={xp.averagePerEarner} label="Average XP per earner" />
          </div>
          <p className={styles.note}>
            XP is a sum over the activity log rather than a stored total, so these cannot disagree with a
            student&rsquo;s own dashboard. Re-pricing an award never changes XP already earned.
          </p>
        </TabPanel>

        <TabPanel id="classes" idPrefix="analytics-detail" active={tab === 'classes'}>
          <Card padding="none">
            <TableScroll label="Registrations and activity by class">
              <Table density="compact">
                <thead>
                  <tr>
                    <th>Class</th>
                    <th>Registered</th>
                    <th>Active</th>
                    <th>XP earned</th>
                    <th aria-label="Share of registrations" />
                  </tr>
                </thead>
                <tbody>
                  {byClass.map((row) => (
                    <tr key={row.classLevel}>
                      <td>{row.classLevel}</td>
                      <td className="tnum">{row.students}</td>
                      <td className={`${styles.muted} tnum`}>{row.activeStudents}</td>
                      <td className={`${styles.muted} tnum`}>{row.xp}</td>
                      <td className={styles.barCell}>
                        <span className={styles.bar} style={{ width: `${(row.students / maxClassStudents) * 100}%` }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>
          <p className={styles.note}>
            Every offered class is listed, including those with nobody in them — a missing row would read as
            missing data, whereas a zero is a fact about the cohort.
          </p>
        </TabPanel>
      </Section>
    </AdminShell>
  )
}
