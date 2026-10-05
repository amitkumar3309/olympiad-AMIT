import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BarChart3, CalendarClock, Crown, Flame, Lightbulb, Star, Target, Trophy } from 'lucide-react'
import StudentShell from '../../components/StudentShell'
import EntryFeeBanner from '../../components/EntryFeeBanner'
import Illustration from '../../components/Illustration'
import type { IllustrationName } from '../../components/illustrations'
import {
  ActivityList,
  Avatar,
  Card,
  CardHeader,
  CountUp,
  EmptyState,
  ErrorState,
  IconTile,
  JourneyTrack,
  LeaderboardTable,
  SkeletonCards,
  SkeletonText,
  StatTile,
  clockOffset,
  type LeaderboardRow as BoardRow,
} from '../../components/ui'
import { api } from '../../api/client'
import type { AnalyticsResponse, DashboardData, NamedPerformanceRow } from '../../api/types'
import { activityIcon, activityTitle } from '../../lib/activity'
import { useAuth } from '../../context/AuthContext'
import { AMIT_SHORT } from '../../lib/brand'
import { formatCompactDuration, formatDateTime, formatDayLabel, formatNumber, formatTime, rotateDaily } from '../../lib/format'
import { DAILY_QUOTES, DASHBOARD_CHAPTERS, MATHS_THOUGHTS } from '../../lib/siteConfig'
import styles from './Dashboard.module.css'

/**
 * Code-split because it renders question content through KaTeX (~300 KB). The card is
 * `components/DailyQuizPanel` — the same component as `/daily-quiz`, so the dashboard
 * and the page can never disagree about what a student may do (brief §6.4).
 */
const DailyQuizPanel = lazy(() => import('../../components/DailyQuizPanel'))

/**
 * The student dashboard (Milestone 30, Phase 4 — the launch mockup, brief §8).
 *
 * **Every figure on this page comes from the server.** `GET /me/dashboard` carries the
 * stat cards, the journey, the activity, today's class board, the exam windows and the
 * achievements; the Daily Quiz card and the chapter progress fetch their own. Where a
 * panel has nothing to show it says *why* — "nobody in Class 9 has earned XP today"
 * and "no Olympiad window is scheduled" are different facts, and a zero would imply the
 * wrong one. A figure that is unknown is an em dash (`StatTile`), never a 0.
 *
 * ## Layout
 *
 * From 1280px the mockup's two columns inside the shell: the main column (welcome, the
 * five figures, today's quiz, the journey, activity and chapters) and a rail (the maths
 * thought, upcoming events, today's top five, achievements). Below 1280px the rail moves
 * under the main column, as a grid of its cards; below 768px everything is one column.
 *
 * ## The welcome banner does not wait
 *
 * It is drawn from the session (the name, the photo flag) and the date, so the page has
 * its `h1` and its greeting the moment it opens — and still has them if the dashboard
 * request fails. The quote of the day turns over at IST midnight.
 */

interface DashboardResponse {
  dashboard: DashboardData
}

/** Art for each journey stage id — the homepage's table, so the two tracks match. */
const JOURNEY_ART: Record<string, IllustrationName> = {
  enrolled: 'journey-enrolled',
  verified: 'journey-verified',
  first_practice: 'journey-first-practice',
  first_challenge: 'journey-first-quiz',
  habit: 'journey-habit',
  first_mock: 'journey-first-mock',
  level_3: 'journey-level-3',
  seasoned: 'journey-seasoned',
  olympiad_ready: 'journey-olympiad-ready',
}

/** Today's IST date as a day key, for the banner's quote before the server has answered. */
function istToday(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
}

export default function Dashboard() {
  const { state } = useAuth()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  /** Server time minus device time, from the response — what the countdown chips use. */
  const [offsetMs, setOffsetMs] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<DashboardResponse>('/me/dashboard')
      setOffsetMs(clockOffset(res.dashboard.serverNow))
      setData(res.dashboard)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const student = state.status === 'student' ? state.student : null
  const today = data?.today ?? istToday()

  return (
    <StudentShell title="Dashboard" headless>
      <div className={styles.page}>
        {/* Renders nothing once the fee is paid or switched off. */}
        <EntryFeeBanner />

        <div className={styles.layout}>
          <div className={styles.main}>
            <WelcomeBanner
              firstName={student?.firstName || student?.fullName || 'there'}
              fullName={student?.fullName ?? ''}
              photo={student?.hasPhoto ? `/api/v1/students/${student.studentId}/photo` : null}
              today={today}
            />

            {loading && <SkeletonCards count={5} label="Loading your figures" className={styles.statGrid} />}
            {!loading && error !== null && <ErrorState error={error} onRetry={() => void load()} />}
            {!loading && error === null && data && <StatCards data={data} />}

            <Suspense
              fallback={
                <Card>
                  <CardHeader title="Today’s Daily Quiz" size="sm" as="h2" />
                  <SkeletonText lines={3} label="Loading today’s quiz" />
                </Card>
              }
            >
              <DailyQuizPanel variant="card" />
            </Suspense>

            {data && <JourneyCard data={data} />}

            <div className={styles.pair}>
              {data && <ActivityCard data={data} />}
              {student && <ChaptersCard studentId={student.studentId} data={data} />}
            </div>
          </div>

          <aside className={styles.rail} aria-label="More for today">
            <ThoughtCard today={today} />
            {data && <UpcomingCard data={data} offsetMs={offsetMs} />}
            {data && <ClassTopCard data={data} />}
            {data && <AchievementsCard data={data} />}
          </aside>
        </div>
      </div>
    </StudentShell>
  )
}

// ---------------------------------------------------------------------------
// The welcome banner
// ---------------------------------------------------------------------------

function WelcomeBanner({ firstName, fullName, photo, today }: { firstName: string; fullName: string; photo: string | null; today: string }) {
  const quote = rotateDaily(DAILY_QUOTES, today)

  return (
    <section className={styles.banner} aria-labelledby="welcome-title">
      <Avatar name={fullName || firstName} src={photo} size="lg" decorative className={styles.bannerAvatar} />
      <div className={styles.bannerText}>
        {/* One heading, read as one sentence: "Welcome back, Asha!" */}
        <h1 id="welcome-title" className={styles.bannerTitle}>
          <span className={styles.bannerEyebrow}>Welcome back,</span>{' '}
          <span className={styles.bannerName}>{firstName}!</span>{' '}
          <span aria-hidden="true">👋</span>
        </h1>
        {quote && <p className={styles.bannerQuote}>“{quote}”</p>}
      </div>
      <div className={styles.bannerArt} aria-hidden="true">
        <Illustration name="book-stack" />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// The five figures
// ---------------------------------------------------------------------------

function StatCards({ data }: { data: DashboardData }) {
  const { progress, stats, leaderboard } = data
  const rank = leaderboard.me.rank
  const accuracy = stats.accuracy

  return (
    <section aria-label="Your figures" className={styles.statGrid}>
      <StatTile
        className={styles.stat}
        layout="value-first"
        icon={<Star aria-hidden="true" />}
        iconTone="gold"
        value={<CountUp value={progress.xp} />}
        label="Total XP"
        delta={
          stats.xpThisWeek > 0
            ? { text: `+${formatNumber(stats.xpThisWeek)} this week`, direction: 'up' }
            : { text: 'None yet this week', direction: 'neutral' }
        }
      />
      <StatTile
        className={styles.stat}
        layout="value-first"
        icon={<Trophy aria-hidden="true" />}
        iconTone="orange"
        // `null`, not zero: "not ranked yet" and "ranked last" are different facts.
        value={rank !== null ? <CountUp value={rank} format={(n) => `#${formatNumber(n)}`} /> : null}
        label="Global rank"
        delta={{
          text: rank !== null ? `out of ${formatNumber(leaderboard.me.totalRanked)}` : 'Earn XP to be ranked',
          direction: 'neutral',
        }}
      />
      <StatTile
        className={styles.stat}
        layout="value-first"
        icon={<Flame aria-hidden="true" />}
        iconTone="magenta"
        value={<CountUp value={progress.streak.current} />}
        label="Day streak"
        delta={
          progress.streak.countedToday && progress.streak.current > 0
            ? { text: 'Keep it going!', direction: 'up' }
            : { text: 'Visit today to keep it', direction: 'neutral' }
        }
      />
      <StatTile
        className={styles.stat}
        layout="value-first"
        icon={<Target aria-hidden="true" />}
        iconTone="blue"
        value={<CountUp value={stats.questionsSolved.total} />}
        label="Questions solved"
        delta={
          stats.questionsSolved.thisWeek > 0
            ? { text: `+${formatNumber(stats.questionsSolved.thisWeek)} this week`, direction: 'up' }
            : { text: 'None yet this week', direction: 'neutral' }
        }
      />
      <StatTile
        className={styles.stat}
        layout="value-first"
        icon={<BarChart3 aria-hidden="true" />}
        iconTone="purple"
        // Rounded down, so the card never claims 100% for 99.6%.
        value={accuracy.percent !== null ? <CountUp value={Math.floor(accuracy.percent)} format={(n) => `${n}%`} /> : null}
        label="Accuracy"
        delta={{
          text:
            accuracy.attempts > 0
              ? `Last ${accuracy.attempts} ${accuracy.attempts === 1 ? 'attempt' : 'attempts'}`
              : 'Answer a question to see it',
          direction: 'neutral',
        }}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

function JourneyCard({ data }: { data: DashboardData }) {
  const { journey } = data
  return (
    <Card className={styles.card}>
      <CardHeader
        title="Your journey"
        size="sm"
        as="h2"
        description={`${journey.completedCount} of ${journey.total} milestones reached`}
        actions={<MoreLink to="/rewards#journey">View full journey</MoreLink>}
      />
      <JourneyTrack
        label="Your journey's milestones"
        stages={journey.stages.map((stage, i) => {
          const art = JOURNEY_ART[stage.id]
          return {
            key: stage.id,
            caption: `Step ${i + 1}`,
            title: stage.title,
            state: stage.complete ? 'done' : stage.current ? 'current' : 'locked',
            art: art ? <Illustration name={art} /> : undefined,
          }
        })}
      />
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Recent activity
// ---------------------------------------------------------------------------

function ActivityCard({ data }: { data: DashboardData }) {
  return (
    <Card className={styles.card}>
      <CardHeader title="Recent activity" size="sm" as="h2" actions={<MoreLink to="/activity">View all</MoreLink>} />
      {data.activity.length === 0 ? (
        <EmptyState
          size="sm"
          icon="ph-list-dashes"
          title="Nothing recorded yet"
          description="Practice, mock tests and the Daily Quiz all appear here as you go, with the XP each one earned."
        />
      ) : (
        <ActivityList
          items={data.activity.map((entry) => {
            return {
              key: entry.id,
              icon: activityIcon(entry),
              tone: entry.xpAwarded > 0 ? 'green' : 'blue',
              title: activityTitle(entry),
              time: `${formatDayLabel(entry.occurredOn, data.today)}, ${formatTime(entry.createdAt)}`,
              value: entry.xpAwarded > 0 ? `+${formatNumber(entry.xpAwarded)} XP` : undefined,
            }
          })}
        />
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Chapter progress — "Subject progress" in the mockup
// ---------------------------------------------------------------------------

/**
 * Accuracy per chapter, from the analytics derivation (`GET /analytics/:studentId`), for
 * the chapters with the most answers. Titled "Chapter progress", not "Subject": this is a
 * mathematics olympiad with one subject, and nothing may print a subject name (CLAUDE.md).
 * Each bar is correct out of answered, with the counts beside it — a real value out of a
 * real maximum.
 */
function ChaptersCard({ studentId, data }: { studentId: string; data: DashboardData | null }) {
  const [rows, setRows] = useState<NamedPerformanceRow[] | null>(null)
  const [failure, setFailure] = useState<unknown>(null)

  const load = useCallback(() => {
    setFailure(null)
    setRows(null)
    api
      .get<AnalyticsResponse>(`/analytics/${studentId}`)
      .then((res) => setRows(res.analytics.byTopic))
      .catch((err: unknown) => setFailure(err))
  }, [studentId])

  useEffect(() => {
    load()
  }, [load])

  const top = useMemo(
    () =>
      (rows ?? [])
        .filter((row) => row.answered > 0)
        .sort((a, b) => b.answered - a.answered)
        .slice(0, DASHBOARD_CHAPTERS),
    [rows],
  )

  const ready = data?.challenges.reduce((total, row) => total + row.questionCount, 0) ?? 0

  return (
    <Card className={styles.card}>
      <CardHeader title="Chapter progress" size="sm" as="h2" actions={<MoreLink to="/analytics">View details</MoreLink>} />
      {failure !== null ? (
        <ErrorState error={failure} titleAs="h3" onRetry={load} />
      ) : rows === null ? (
        <SkeletonText lines={5} label="Loading your chapters" />
      ) : top.length === 0 ? (
        <EmptyState
          size="sm"
          icon="ph-chart-bar"
          title="No chapters answered yet"
          description={
            ready > 0
              ? `${formatNumber(ready)} questions are ready for you in Practice. Your accuracy in each chapter appears here as you answer.`
              : 'Your accuracy in each chapter appears here once you have answered some questions.'
          }
        />
      ) : (
        <ul className={styles.chapters}>
          {top.map((row, i) => {
            const percent = row.accuracyPercent ?? 0
            return (
              <li key={row.id} className={styles.chapter}>
                <span className={styles.chapterDot} style={{ background: `var(--series-${(i % 5) + 1})` }} aria-hidden="true" />
                <span className={styles.chapterName}>{row.name}</span>
                <span
                  className={styles.chapterBar}
                  role="img"
                  aria-label={`${row.correct} of ${row.answered} correct`}
                >
                  <span
                    className={styles.chapterFill}
                    style={{ width: `${Math.min(100, percent)}%`, background: `var(--series-${(i % 5) + 1})` }}
                  />
                </span>
                <span className={`${styles.chapterValue} tnum`}>{row.accuracyPercent !== null ? `${Math.floor(row.accuracyPercent)}%` : '—'}</span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// The rail
// ---------------------------------------------------------------------------

function ThoughtCard({ today }: { today: string }) {
  const thought = rotateDaily(MATHS_THOUGHTS, today, 3)
  if (!thought) return null
  return (
    <section className={styles.thought} aria-labelledby="thought-title">
      <div className={styles.thoughtText}>
        <h2 id="thought-title" className={styles.thoughtTitle}>
          <Lightbulb aria-hidden="true" /> Today’s Maths Thought
        </h2>
        <p className={styles.thoughtQuote}>“{thought}”</p>
        <p className={styles.thoughtSign}>— {AMIT_SHORT}</p>
      </div>
      <div className={styles.thoughtArt} aria-hidden="true">
        <Illustration name="plant" />
      </div>
    </section>
  )
}

/**
 * Upcoming events: the real Olympiad windows for the student's class, soonest first,
 * each with a countdown chip offset from the server's clock. The Boss Battle and the
 * Month-End Booster in the mockup do not exist (PLAN.md Q6), so they are not here.
 */
function UpcomingCard({ data, offsetMs }: { data: DashboardData; offsetMs: number }) {
  const now = Date.now() + offsetMs
  return (
    <Card className={styles.card}>
      <CardHeader title="Upcoming events" size="sm" as="h2" actions={<MoreLink to="/exam">View all</MoreLink>} />
      {data.upcoming.length === 0 ? (
        <EmptyState
          size="sm"
          icon="ph-calendar-blank"
          title="Nothing scheduled yet"
          description={
            data.student.classLevel
              ? `No Olympiad window is scheduled for ${data.student.classLevel} yet. It appears here, with a countdown, as soon as it is.`
              : 'Add your class to your profile to see your Olympiad dates here.'
          }
        />
      ) : (
        <ul className={styles.events}>
          {data.upcoming.map((exam) => {
            const opensIn = Math.max(0, (Date.parse(exam.opensAt) - now) / 1000)
            return (
              <li key={exam.id} className={styles.event}>
                <IconTile icon={<CalendarClock aria-hidden="true" />} tone="magenta" size="sm" />
                <span className={styles.eventText}>
                  <span className={styles.eventTitle}>{exam.title}</span>
                  <span className={styles.eventWhen}>{formatDateTime(exam.isOpen ? exam.closesAt : exam.opensAt)}</span>
                </span>
                <span className={exam.isOpen ? styles.chipOpen : styles.chip}>
                  {exam.isOpen ? (
                    <>
                      Open now<span className="sr-only">, closes {formatDateTime(exam.closesAt)}</span>
                    </>
                  ) : (
                    <>
                      <span className="sr-only">Opens in </span>
                      {formatCompactDuration(opensIn)}
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/**
 * Today's top five in the student's own class, from the one ranking service. The reader's
 * row is highlighted, and when they are outside the five it follows a "…" row. Names are
 * as every board shows them — masked, or "A Class 9 student" for an opted-out child.
 */
function ClassTopCard({ data }: { data: DashboardData }) {
  const board = data.classToday
  if (!board) {
    return (
      <Card className={styles.card}>
        <CardHeader title="Today’s top 5" size="sm" as="h2" />
        <EmptyState
          size="sm"
          icon="ph-ranking"
          title="Add your class to see your board"
          description="Today’s top five is drawn from your own class. Set it on your profile."
        />
      </Card>
    )
  }

  const own = data.student.studentId
  const rows: BoardRow[] = board.rows.map((row) => ({
    key: row.studentId,
    rank: row.rank,
    name: row.displayName,
    avatar: <Avatar name={row.displayName} size="xs" tint decorative />,
    cells: [formatNumber(row.xp)],
    highlight: row.studentId === own,
    rankMarker: row.rank <= 3 ? <Crown aria-hidden="true" className={styles[`crown${row.rank}`]} /> : undefined,
  }))
  // Outside the five: their own row after a "…", with their real rank.
  if (!board.rows.some((row) => row.studentId === own) && board.me.rank !== null) {
    rows.push({
      key: own,
      rank: board.me.rank,
      name: data.student.firstName ?? 'You',
      avatar: <Avatar name={data.student.fullName ?? 'You'} size="xs" tint decorative />,
      cells: [formatNumber(board.me.xp)],
      highlight: true,
      gapBefore: true,
    })
  }

  return (
    <Card className={styles.card}>
      <CardHeader
        title={`Today’s top 5 (${board.classLevel})`}
        size="sm"
        as="h2"
        actions={<MoreLink to="/leaderboard?scope=class&period=daily">View leaderboard</MoreLink>}
      />
      {board.rows.length === 0 ? (
        <EmptyState
          size="sm"
          icon="ph-ranking"
          title="Nobody on today’s board yet"
          description={`Nobody in ${board.classLevel} has earned XP today. Answer today’s Daily Quiz or practise to be first.`}
        />
      ) : (
        <>
          <LeaderboardTable caption={`Today’s top five in ${board.classLevel}`} columns={['XP']} align={['end']} rows={rows} />
          {board.me.rank === null && <p className={styles.note}>Earn XP today to join this board.</p>}
        </>
      )}
    </Card>
  )
}

/** Earned achievements in colour, the nearest locked ones greyed, four in all. */
function AchievementsCard({ data }: { data: DashboardData }) {
  const shown = [
    ...data.achievements.earned.map((a) => ({ ...a, locked: false })),
    ...data.achievements.next.map((a) => ({ ...a, locked: true })),
  ].slice(0, 4)

  return (
    <Card className={styles.card}>
      <CardHeader
        title="Achievements"
        size="sm"
        as="h2"
        description={`${data.achievements.earnedCount} of ${data.achievements.total} earned`}
        actions={<MoreLink to="/rewards#achievements">View all</MoreLink>}
      />
      {shown.length === 0 ? (
        <EmptyState size="sm" icon="ph-medal" title="No achievements yet" description="Badges appear here as you practise, keep a streak going and sit papers." />
      ) : (
        <ul className={styles.achievements}>
          {shown.map((a) => (
            <li key={a.code} className={a.locked ? styles.achievementLocked : styles.achievement} title={a.description}>
              <IconTile icon={a.icon} tone={a.locked ? 'neutral' : 'gold'} size="lg" />
              <span className={styles.achievementName}>{a.name}</span>
              <span className={styles.achievementState}>
                {a.locked ? `Locked · ${formatNumber(a.progress)}/${formatNumber(a.target)}` : 'Earned'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** "View all →" — a card header's link to the page that has the rest. */
function MoreLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className={styles.more}>
      {children}
      <ArrowRight aria-hidden="true" />
    </Link>
  )
}
