import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import EntryFeeBanner from '../../components/EntryFeeBanner'
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  DataCard,
  DataCardList,
  DataRow,
  EmptyState,
  ErrorState,
  Icon,
  Progress,
  SkeletonCards,
  SkeletonText,
  StatTile,
  Table,
  TableScroll,
} from '../../components/ui'
import { api } from '../../api/client'
import { ACTIVITY_LABELS, type ActivityEntry, type DashboardData, type Pagination } from '../../api/types'
import styles from './Dashboard.module.css'

/**
 * Code-split because it renders question content through KaTeX (~300 KB). Every
 * student opens this dashboard, so that cost is paid only when their class actually
 * has a published challenge to show. See `DailyChallengeCard.tsx`.
 */
const DailyChallengeCard = lazy(() => import('./DailyChallengeCard'))

/**
 * The student dashboard.
 *
 * **Every figure on this page comes from `GET /me/dashboard`.** The version this
 * replaced showed three hardcoded stat tiles ("1,280 challenges solved today",
 * "8.91s fastest solve", "450+ participating schools") and a three-name leaderboard
 * of invented students — none of it connected to anything. There is now no constant
 * on this page that a student could mistake for data.
 *
 * Where a panel has nothing to show, it renders an explicit empty state that says
 * *why* it is empty. That distinction matters: "you have not taken a test yet" and
 * "exams are not running yet" are different messages, and showing a zero would imply
 * the wrong one.
 *
 * ## What Milestone 23 Phase D changed
 *
 * The order. It opened with four figures and ended, seven cards later, with the
 * actions — so the thing a student came to do was the last thing on the page, below
 * the fold on every phone. It now opens with **what to do next** (practice, mock
 * tests, today's challenge), then how it is going, then the record. Nothing was
 * removed and no new request was added.
 */

interface DashboardResponse {
  dashboard: DashboardData
}

/** "today", "yesterday", or a short date — for the activity feed. */
function relativeDay(occurredOn: string, today: string): string {
  if (occurredOn === today) return 'Today'
  const day = Date.parse(`${occurredOn}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  const daysAgo = Math.round((now - day) / 86_400_000)
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo < 7) return `${daysAgo} days ago`
  return new Date(day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)

  /**
   * Activity beyond the newest few the dashboard payload carries. Held separately so
   * a reload of the dashboard does not silently discard what the student has paged
   * through, and so the feed has one source of truth: `extraActivity` is appended to
   * `data.activity`, never merged into it.
   */
  const [extraActivity, setExtraActivity] = useState<ActivityEntry[]>([])
  const [activityPage, setActivityPage] = useState(1)
  const [activityTotal, setActivityTotal] = useState<number | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<DashboardResponse>('/me/dashboard')
      setData(res.dashboard)
      // A fresh dashboard resets the feed, otherwise a newly recorded event would
      // appear above rows the student had already paged past and read as a duplicate.
      setExtraActivity([])
      setActivityPage(1)
      setActivityTotal(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  /**
   * Pages the full feed from `GET /me/activity`. Asks for the page *after* what is
   * already on screen, using the dashboard's own page size so the offsets line up.
   */
  const loadMoreActivity = useCallback(async () => {
    if (!data) return
    setLoadingMore(true)
    try {
      const limit = data.activity.length || 8
      const next = activityPage + 1
      const res = await api.get<{ entries: ActivityEntry[]; pagination: Pagination }>(
        `/me/activity?page=${next}&limit=${limit}`,
      )
      setExtraActivity((current) => [...current, ...res.entries])
      setActivityPage(next)
      setActivityTotal(res.pagination.total)
    } catch {
      // A failed "load more" must not blank the feed already on screen, so the
      // error is swallowed and the button simply stays available to retry.
      setActivityTotal(null)
    } finally {
      setLoadingMore(false)
    }
  }, [data, activityPage])

  useEffect(() => {
    void load()
  }, [load])

  const activity = data ? [...data.activity, ...extraActivity] : []
  const hasMoreActivity =
    data !== null &&
    (activityTotal === null ? data.activity.length >= 8 : activity.length < activityTotal)

  return (
    <StudentShell
      title={data ? `Welcome back, ${data.student.firstName ?? data.student.fullName}` : 'Dashboard'}
      subtitle={
        data
          ? `${data.student.studentId}${data.student.classLevel ? ` · ${data.student.classLevel}` : ''}`
          : undefined
      }
    >
      {/* Sits above everything and renders nothing once the fee is paid or switched
          off. Outside the `data` guard on purpose: whether the student has entered
          does not depend on their dashboard figures loading. */}
      <EntryFeeBanner />

      {loading && (
        <div className={styles.page}>
          <SkeletonCards count={3} label="Loading your dashboard" />
          <SkeletonCards count={4} label="Loading your progress" />
        </div>
      )}

      {!loading && error !== null && <ErrorState error={error} titleAs="h2" onRetry={() => void load()} />}

      {!loading && error === null && data && (
        <div className={styles.page}>
          {/* -----------------------------------------------------------
              What to do next. First, because it is what a student opened
              the page for — this used to be the last card on it.
          ----------------------------------------------------------- */}
          <section aria-labelledby="next-heading">
            <h2 id="next-heading" className={styles.sectionTitle}>
              Jump back in
            </h2>
            <div className={styles.actionGrid}>
              <Link to="/practice" className={styles.actionCard}>
                <span className={styles.actionIcon}>
                  <Icon name="ph-target" weight="bold" size="md" />
                </span>
                <span className={styles.actionText}>
                  <span className={styles.actionTitle}>Practice</span>
                  <span className={styles.actionMeta}>
                    {data.challenges.length > 0
                      ? `${data.challenges.reduce((total, row) => total + row.questionCount, 0)} questions ready for ${data.student.classLevel ?? 'your class'}`
                      : 'Choose a chapter and difficulty'}
                  </span>
                </span>
                <Icon name="ph-caret-right" size="sm" className={styles.actionChevron} />
              </Link>

              <Link to="/mock-tests" className={styles.actionCard}>
                <span className={styles.actionIcon}>
                  <Icon name="ph-exam" weight="bold" size="md" />
                </span>
                <span className={styles.actionText}>
                  <span className={styles.actionTitle}>Mock tests</span>
                  <span className={styles.actionMeta}>Sit a full paper against the clock</span>
                </span>
                <Icon name="ph-caret-right" size="sm" className={styles.actionChevron} />
              </Link>

              <Link to="/daily-challenge" className={styles.actionCard}>
                <span className={styles.actionIcon}>
                  <Icon name="ph-dice-five" weight="bold" size="md" />
                </span>
                <span className={styles.actionText}>
                  <span className={styles.actionTitle}>Daily challenge</span>
                  <span className={styles.actionMeta}>One question a day, marked instantly</span>
                </span>
                <Icon name="ph-caret-right" size="sm" className={styles.actionChevron} />
              </Link>
            </div>
          </section>

          {/* -----------------------------------------------------------
              Progress — XP, level, streak, rank, achievements
          ----------------------------------------------------------- */}
          <section aria-labelledby="progress-heading">
            <h2 id="progress-heading" className={styles.sectionTitle}>
              Your progress
            </h2>
            <div className={styles.progressGrid}>
              <Card className={styles.levelCard}>
                <div className={styles.levelHead}>
                  <div>
                    <Badge tone="primary" uppercase>
                      Level {data.progress.level}
                    </Badge>
                    <p className={styles.xpValue}>{data.progress.xp.toLocaleString('en-IN')} XP</p>
                  </div>
                  <span className={styles.levelIcon}>
                    <Icon name="ph-trend-up" weight="bold" size="md" />
                  </span>
                </div>
                {/*
                  A real value out of a real maximum — XP into this level, out of what
                  the level costs. Nothing here eases towards a number nobody computed.
                */}
                <Progress
                  value={data.progress.xpIntoLevel}
                  max={data.progress.xpForNextLevel}
                  aria-label={`Progress to level ${data.progress.level + 1}`}
                  valueText={`${data.progress.xpForNextLevel - data.progress.xpIntoLevel} XP to level ${data.progress.level + 1}`}
                />
              </Card>

              <StatTile
                icon="ph-flame"
                tone="warning"
                label="Current streak"
                value={`${data.progress.streak.current} ${data.progress.streak.current === 1 ? 'day' : 'days'}`}
                hint={
                  !data.progress.streak.countedToday && data.progress.streak.current > 0
                    ? 'Visit today to keep it going.'
                    : data.progress.streak.longest > data.progress.streak.current
                      ? `Best: ${data.progress.streak.longest} days`
                      : undefined
                }
              />

              <StatTile
                icon="ph-ranking"
                label="Leaderboard rank"
                // `null`, not zero: "not ranked yet" and "ranked last" are different
                // facts, and the tile renders an em dash for the first.
                value={data.leaderboard.me.rank !== null ? `#${data.leaderboard.me.rank}` : null}
                hint={
                  data.leaderboard.me.rank !== null
                    ? `of ${data.leaderboard.me.totalRanked} ranked`
                    : 'Earn XP to join the leaderboard.'
                }
              />

              <StatTile
                icon="ph-medal"
                tone="success"
                label="Achievements"
                value={`${data.achievements.earnedCount}/${data.achievements.total}`}
                hint="Earned so far"
              />
            </div>
          </section>

          {/* -----------------------------------------------------------
              Today's challenge, then the record.
          ----------------------------------------------------------- */}
          <div className={styles.grid}>
            <Suspense
              fallback={
                <Card>
                  <CardHeader title="Today's challenge" size="sm" as="h3" />
                  <SkeletonText lines={3} label="Loading today's challenge" />
                </Card>
              }
            >
              <DailyChallengeCard />
            </Suspense>

            {/* --------- Practice available for this class --------- */}
            <Card>
              <CardHeader
                title="Practice available to you"
                size="sm"
                as="h3"
                actions={
                  data.challenges.length > 0 ? (
                    <ButtonLink to="/practice" size="sm" variant="secondary" icon="ph-target">
                      Start
                    </ButtonLink>
                  ) : undefined
                }
              />
              {data.challenges.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon="ph-books"
                  title="Nothing published yet"
                  description={
                    data.student.classLevel
                      ? `No questions have been published for ${data.student.classLevel} yet. This fills up as chapters are released.`
                      : 'Add your class to your profile and we can show you what is available.'
                  }
                  action={
                    !data.student.classLevel ? (
                      <ButtonLink to="/profile" size="sm" variant="secondary">
                        Update my profile
                      </ButtonLink>
                    ) : undefined
                  }
                />
              ) : (
                <ul className={styles.availability}>
                  {data.challenges.map((challenge) => (
                    <li key={challenge.subjectId}>
                      <div className={styles.availabilityText}>
                        {/*
                          The class, not the subject. This row is per-subject in the API and there
                          is exactly one, so printing its name told a student "Mathematics" on a
                          mathematics olympiad's dashboard. The class is the fact that actually
                          varies between two students looking at this tile.
                        */}
                        <span className={styles.availabilityName}>{data.student.classLevel}</span>
                        <span className={styles.availabilityMeta}>{challenge.difficulties.join(' · ')}</span>
                      </div>
                      <Badge tone="neutral">
                        {challenge.questionCount} {challenge.questionCount === 1 ? 'question' : 'questions'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            {/* --------- Recent test performance --------- */}
            <Card className={styles.wide}>
              <CardHeader title="Recent test performance" size="sm" as="h3" />
              {data.recentTests.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon="ph-hourglass"
                  title="No results yet"
                  description="Your marks and accuracy from the official Olympiad appear here once you have sat it. Mock test results live on the Mock Tests page."
                  action={
                    <ButtonLink to="/mock-tests" size="sm" variant="secondary" icon="ph-exam">
                      See mock tests
                    </ButtonLink>
                  }
                />
              ) : (
                <>
                  {/* One card per paper on a phone; the table returns from 768px. Not a
                      squeezed table: five numeric columns on a 375px screen is five
                      illegible columns. */}
                  <DataCardList className={styles.mobileOnly}>
                    {data.recentTests.map((test) => (
                      <DataCard
                        key={test.id}
                        title={test.submittedAt ? new Date(test.submittedAt).toLocaleDateString('en-IN') : 'Submitted'}
                        status={<Badge tone="primary">{test.accuracy}%</Badge>}
                      >
                        <DataRow label="Score">{test.totalScore}</DataRow>
                        <DataRow label="Questions">{test.questionCount}</DataRow>
                        <DataRow label="Time">{formatDuration(test.timeTakenSeconds)}</DataRow>
                      </DataCard>
                    ))}
                  </DataCardList>

                  <div className={styles.desktopOnly}>
                    <TableScroll label="Recent test performance">
                      <Table density="compact">
                        <thead>
                          <tr>
                            <th>Submitted</th>
                            <th>Score</th>
                            <th>Accuracy</th>
                            <th>Questions</th>
                            <th>Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.recentTests.map((test) => (
                            <tr key={test.id}>
                              <td>
                                {test.submittedAt ? new Date(test.submittedAt).toLocaleDateString('en-IN') : '—'}
                              </td>
                              <td>{test.totalScore}</td>
                              <td>{test.accuracy}%</td>
                              <td>{test.questionCount}</td>
                              <td>{formatDuration(test.timeTakenSeconds)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </TableScroll>
                  </div>
                </>
              )}
            </Card>

            {/* --------- Recent activity --------- */}
            <Card>
              <CardHeader title="Recent activity" size="sm" as="h3" />
              {activity.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon="ph-list-dashes"
                  title="Nothing recorded yet"
                  description="Practice, mock tests and the daily challenge all appear here as you go, with the XP each one earned."
                />
              ) : (
                <>
                  <ul className={styles.feed}>
                    {activity.map((entry) => {
                      const meta = ACTIVITY_LABELS[entry.type]
                      return (
                        <li key={entry.id}>
                          <span className={styles.feedIcon}>
                            <Icon name={meta?.icon ?? 'ph-dot'} weight="bold" size="sm" />
                          </span>
                          <div className={styles.feedBody}>
                            <span className={styles.feedLabel}>{meta?.label ?? entry.type}</span>
                            {entry.detail && <span className={styles.feedDetail}>{entry.detail}</span>}
                          </div>
                          <span className={styles.feedDay}>{relativeDay(entry.occurredOn, data.today)}</span>
                          {entry.xpAwarded > 0 && (
                            <Badge tone="success" size="sm">
                              +{entry.xpAwarded} XP
                            </Badge>
                          )}
                        </li>
                      )
                    })}
                  </ul>

                  {/* Offered whenever a full first page came back, since that is the
                      only signal that more may exist before we have asked. Once the
                      server has told us the total, that decides it. */}
                  {hasMoreActivity && (
                    <Button
                      variant="ghost"
                      size="sm"
                      fullWidth
                      icon="ph-caret-down"
                      loading={loadingMore}
                      onClick={() => void loadMoreActivity()}
                    >
                      {loadingMore ? 'Loading' : 'Show earlier activity'}
                    </Button>
                  )}
                  {activityTotal !== null && activity.length >= activityTotal && (
                    <p className={styles.feedEnd}>That is your whole history — {activityTotal} events.</p>
                  )}
                </>
              )}
            </Card>

            {/* --------- Achievements --------- */}
            <Card>
              <CardHeader
                title="Achievements"
                size="sm"
                as="h3"
                actions={
                  <ButtonLink to="/rewards" size="sm" variant="ghost">
                    All rewards
                  </ButtonLink>
                }
              />
              {data.achievements.earned.length > 0 && (
                <ul className={styles.badgeList}>
                  {data.achievements.earned.map((achievement) => (
                    <li key={achievement.code}>
                      <Badge tone="accent" icon={achievement.icon} title={achievement.description}>
                        {achievement.name}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {data.achievements.next.length > 0 && (
                <>
                  <p className={styles.subhead}>Closest to earning</p>
                  <ul className={styles.nextList}>
                    {data.achievements.next.map((achievement) => (
                      <li key={achievement.code}>
                        <Progress
                          label={achievement.name}
                          value={achievement.progress}
                          max={achievement.target}
                          size="sm"
                          valueText={`${achievement.progress}/${achievement.target}`}
                        />
                        <p className={styles.nextDesc}>{achievement.description}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {data.achievements.earned.length === 0 && data.achievements.next.length === 0 && (
                <EmptyState
                  size="sm"
                  icon="ph-medal"
                  title="No achievements yet"
                  description="Badges appear here as you practise, keep a streak going and sit papers."
                />
              )}
            </Card>

            {/* --------- Leaderboard --------- */}
            <Card>
              <CardHeader
                title="Leaderboard"
                size="sm"
                as="h3"
                actions={
                  <ButtonLink to="/leaderboard" size="sm" variant="ghost">
                    Full board
                  </ButtonLink>
                }
              />
              {data.leaderboard.top.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon="ph-trophy"
                  title="Nobody has earned XP yet"
                  description="The board fills as students practise. Be the first name on it."
                />
              ) : (
                <ol className={styles.leaderboard}>
                  {data.leaderboard.top.map((row) => {
                    const isMe = row.studentId === data.student.studentId
                    return (
                      <li key={row.studentId} className={isMe ? styles.meRow : undefined}>
                        <span className={styles.rank}>#{row.rank}</span>
                        <span className={styles.lbText}>
                          <span className={styles.lbName}>{isMe ? 'You' : row.displayName}</span>
                          {row.schoolName && <span className={styles.lbSchool}>{row.schoolName}</span>}
                        </span>
                        <span className={styles.lbXp}>{row.xp.toLocaleString('en-IN')} XP</span>
                      </li>
                    )
                  })}
                </ol>
              )}
              {data.leaderboard.me.rank !== null && data.leaderboard.me.rank > data.leaderboard.top.length && (
                <p className={styles.subhead}>
                  You are #{data.leaderboard.me.rank} of {data.leaderboard.me.totalRanked}, with{' '}
                  {data.leaderboard.me.xp.toLocaleString('en-IN')} XP.
                </p>
              )}
            </Card>
          </div>
        </div>
      )}
    </StudentShell>
  )
}
