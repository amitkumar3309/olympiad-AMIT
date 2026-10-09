import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import type {
  AdminDailyQuizListResponse,
  AdminQuiz,
  PrizeDeskResponse,
  PrizeDeskView,
  QuizPhase,
  QuizPrizeInfo,
  QuizSettings,
  QuizWinnerRow,
  ReminderRun,
} from '../../api/types'
import AdminShell from './AdminShell'
import MathText from '../../components/MathText'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Pagination,
  SkeletonTable,
  SkeletonText,
  TabPanel,
  Table,
  TableScroll,
  Tabs,
  type BadgeTone,
  useToast,
} from '../../components/ui'
import { formatDateTime, formatDayKey, formatNumber, formatSolveTime } from '../../lib/format'
import { humanizeError } from '../../lib/errors'
import ScheduleDialog from './DailyQuizSchedule'
import { QuizBankBulk, QuizFileImport } from './DailyQuizBulk'
import WinnerTable from './DailyQuizWinners'
import MonthlyWinners from './DailyQuizMonthly'
import styles from './DailyQuiz.module.css'

/**
 * Running the Daily Quiz (Milestone 30, Phase 2 — brief §6.5). The daily challenge's
 * console, rebuilt for a prize quiz:
 *
 *  - **Calendar** — the next fortnight from the server's own today, with a warning for any
 *    class group that has no quiz in the next three days (there is no automatic fill any
 *    more, so a gap is a day with no quiz), and every quiz with its figures.
 *  - **Import** and **From the bank** — loading weeks at once, dry run first.
 *  - **Monthly winners** — one winner a month in each class band (owner, 2026-10-09 —
 *    PLAN.md Q24): work out a band's candidates once the month is over, confirm, announce.
 *  - **Prize desk** — every winner still needing a person: to announce, to call, to deliver.
 *  - **Settings** — the prize and when results are shown, beside the public "how winners are
 *    chosen" sentence exactly as the server generates it — fetched, never re-written here, so
 *    the console cannot show different words from the site. The rule itself is not a setting.
 *    And the 7:00 AM reminder emails (Milestone 30 Phase 7b): the switch, the daily cap, and
 *    what the job did the last time the scheduler called it.
 *
 * Days come from the server (`calendar.today`), never the browser: a competition day is an
 * IST day, and a laptop elsewhere disagrees about which one is today.
 */

type TabId = 'calendar' | 'import' | 'bank' | 'monthly' | 'prizes' | 'settings'
const TABS: TabId[] = ['calendar', 'import', 'bank', 'monthly', 'prizes', 'settings']

const PHASE_BADGE: Record<QuizPhase, { tone: BadgeTone; label: string }> = {
  upcoming: { tone: 'neutral', label: 'Upcoming' },
  open: { tone: 'danger', label: 'Live' },
  revealed: { tone: 'success', label: 'Closed' },
}

export default function AdminDailyQuiz() {
  const [params, setParams] = useSearchParams()
  const handoff = useMemo(() => (params.get('questions') ?? '').split(',').filter(Boolean), [params])
  const requested = params.get('tab') as TabId | null
  const tab: TabId = requested && TABS.includes(requested) ? requested : handoff.length > 0 ? 'bank' : 'calendar'

  const [data, setData] = useState<AdminDailyQuizListResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [page, setPage] = useState(1)
  const [scheduling, setScheduling] = useState<{ day?: string } | null>(null)
  const [outstanding, setOutstanding] = useState<number | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api.get<AdminDailyQuizListResponse>(`/admin/daily-quiz?page=${page}&limit=20`))
    } catch (err) {
      setError(err)
    }
  }, [page])

  const loadOutstanding = useCallback(async () => {
    try {
      const res = await api.get<PrizeDeskResponse>('/admin/daily-quiz/winners?view=outstanding&limit=1')
      setOutstanding(res.outstanding)
    } catch {
      setOutstanding(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadOutstanding()
  }, [loadOutstanding])

  function setTab(next: string) {
    const nextParams = new URLSearchParams(params)
    nextParams.set('tab', next)
    setParams(nextParams, { replace: true })
  }

  const today = data?.calendar.today ?? null

  return (
    <AdminShell
      title="Daily Quiz"
      subtitle="One question a day per class group. Each month, the top scorer in every class band wins the prize."
      actions={
        <Button icon="ph-calendar-plus" disabled={!today} onClick={() => setScheduling({})}>
          Schedule a quiz
        </Button>
      }
    >
      <Tabs
        idPrefix="daily-quiz"
        label="Daily Quiz sections"
        value={tab}
        onChange={setTab}
        items={[
          { id: 'calendar', label: 'Calendar', icon: 'ph-calendar' },
          { id: 'import', label: 'Import a file', icon: 'ph-upload-simple' },
          { id: 'bank', label: 'From the bank', icon: 'ph-bank' },
          { id: 'monthly', label: 'Monthly winners', icon: 'ph-trophy' },
          { id: 'prizes', label: 'Prize desk', icon: 'ph-gift', count: outstanding ?? undefined },
          { id: 'settings', label: 'Settings', icon: 'ph-gear' },
        ]}
      />

      <TabPanel id="calendar" idPrefix="daily-quiz" active={tab === 'calendar'}>
        {error !== null ? (
          <ErrorState titleAs="h2" title="Could not load the Daily Quiz" error={error} onRetry={() => void load()} />
        ) : !data ? (
          <Card>
            <SkeletonTable rows={6} />
          </Card>
        ) : (
          <div className={styles.stack}>
            {data.calendar.warnings.map((warning) => (
              <Alert
                key={warning.group}
                tone="warning"
                title={`${warning.label} has no quiz on ${formatDayKey(warning.day)}`}
                actions={
                  <Button size="sm" variant="secondary" onClick={() => setScheduling({ day: warning.day })}>
                    Schedule it
                  </Button>
                }
              >
                {warning.missingClasses.length === 1 ? `Class ${warning.missingClasses[0]} has` : `Classes ${warning.missingClasses.join(', ')} have`}{' '}
                nothing scheduled. With no automatic fill, students in {warning.missingClasses.length === 1 ? 'that class' : 'those classes'} will see
                “No quiz today”.
              </Alert>
            ))}

            <Card>
              <CardHeader title="The next 14 days" as="h2" size="sm" description="India time. Select a day to schedule a quiz on it." />
              <ol className={styles.calendar}>
                {data.calendar.days.map((day) => (
                  <li key={day.day} className={styles.calendarDay} data-today={day.day === data.calendar.today}>
                    <span className={styles.calendarDate}>
                      {day.day === data.calendar.today ? 'Today' : formatDayKey(day.day)}
                    </span>
                    <span className={styles.calendarQuizzes}>
                      {day.quizzes.length === 0 ? (
                        <span className={styles.muted}>No quiz</span>
                      ) : (
                        day.quizzes.map((quiz) => (
                          <Link
                            key={quiz.groupId}
                            to={`/admin/daily-quiz/${quiz.groupId}`}
                            className={styles.calendarChip}
                            data-legacy={quiz.legacy}
                            title={quiz.legacy ? 'A daily challenge from before the Daily Quiz. Open it to remove it.' : undefined}
                          >
                            {quiz.label}
                          </Link>
                        ))
                      )}
                    </span>
                    <Button size="sm" variant="ghost" icon="ph-plus" aria-label={`Schedule a quiz on ${formatDayKey(day.day)}`} onClick={() => setScheduling({ day: day.day })}>
                      Add
                    </Button>
                  </li>
                ))}
              </ol>
            </Card>

            <Card>
              <CardHeader title="Every quiz" as="h2" size="sm" description="Newest first, with how each one landed." />
              {data.quizzes.length === 0 ? (
                <EmptyState
                  titleAs="h3"
                  icon="ph-calendar-blank"
                  title="No quizzes yet"
                  description="Schedule one, import a file of them, or pick questions from the bank. Students see “No quiz today” until you do."
                  action={
                    <Button icon="ph-calendar-plus" onClick={() => setScheduling({})}>
                      Schedule a quiz
                    </Button>
                  }
                />
              ) : (
                <>
                  <TableScroll label="Daily quizzes">
                    <Table density="comfortable">
                      <thead>
                        <tr>
                          <th scope="col">Day</th>
                          <th scope="col">Classes</th>
                          <th scope="col">Question</th>
                          <th scope="col">Played</th>
                          <th scope="col">Correct</th>
                          <th scope="col">Median time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.quizzes.map((quiz: AdminQuiz) => (
                          <tr key={quiz.groupId}>
                            <td>
                              <Link to={`/admin/daily-quiz/${quiz.groupId}`}>{formatDayKey(quiz.day)}</Link>
                              <div>
                                <Badge size="sm" tone={PHASE_BADGE[quiz.phase].tone}>
                                  {PHASE_BADGE[quiz.phase].label}
                                </Badge>
                              </div>
                            </td>
                            <td>{quiz.classRange.label}</td>
                            <td className={styles.questionCell}>
                              {quiz.question.text ? <MathText>{quiz.question.text}</MathText> : <span className={styles.muted}>A daily challenge from before the quiz</span>}
                            </td>
                            <td className={styles.figure}>
                              {quiz.stats.started === 0 ? (
                                <span className={styles.muted}>Nobody yet</span>
                              ) : (
                                <>
                                  {quiz.stats.submitted} submitted
                                  <div className={styles.muted}>{quiz.stats.started} started</div>
                                </>
                              )}
                            </td>
                            <td className={styles.figure}>{quiz.stats.correctPercent === null ? '—' : `${quiz.stats.correctPercent}%`}</td>
                            <td className={styles.figure}>{quiz.stats.medianSolveMs === null ? '—' : formatSolveTime(quiz.stats.medianSolveMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </TableScroll>
                  {data.pagination.totalPages > 1 && (
                    <Pagination
                      page={page}
                      pageCount={data.pagination.totalPages}
                      total={data.pagination.total}
                      pageSize={data.pagination.limit}
                      onChange={setPage}
                      label="Quiz pages"
                    />
                  )}
                </>
              )}
            </Card>
          </div>
        )}
      </TabPanel>

      <TabPanel id="import" idPrefix="daily-quiz" active={tab === 'import'}>
        <QuizFileImport onScheduled={() => void load()} />
      </TabPanel>

      <TabPanel id="bank" idPrefix="daily-quiz" active={tab === 'bank'}>
        {today ? (
          <QuizBankBulk today={today} initialIds={handoff} onScheduled={() => void load()} />
        ) : (
          <Card>
            <SkeletonText lines={4} label="Loading" />
          </Card>
        )}
      </TabPanel>

      <TabPanel id="monthly" idPrefix="daily-quiz" active={tab === 'monthly'}>
        {tab === 'monthly' && <MonthlyWinners initialMonth={params.get('month')} onChanged={() => void loadOutstanding()} />}
      </TabPanel>

      <TabPanel id="prizes" idPrefix="daily-quiz" active={tab === 'prizes'}>
        <PrizeDesk onChanged={() => void loadOutstanding()} />
      </TabPanel>

      <TabPanel id="settings" idPrefix="daily-quiz" active={tab === 'settings'}>
        <SettingsForm />
      </TabPanel>

      {today && (
        <ScheduleDialog
          open={scheduling !== null}
          today={today}
          initialDay={scheduling?.day}
          onClose={() => setScheduling(null)}
          onScheduled={() => {
            setScheduling(null)
            toast.success('Quiz scheduled.')
            void load()
          }}
        />
      )}
    </AdminShell>
  )
}

// ---------------------------------------------------------------------------
// The prize desk
// ---------------------------------------------------------------------------

const DESK_VIEWS: Array<{ id: PrizeDeskView; label: string }> = [
  { id: 'outstanding', label: 'Needs action' },
  { id: 'published', label: 'Announced' },
  { id: 'disqualified', label: 'Disqualified' },
  { id: 'all', label: 'All decided' },
]

function PrizeDesk({ onChanged }: { onChanged: () => void }) {
  const [view, setView] = useState<PrizeDeskView>('outstanding')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PrizeDeskResponse | null>(null)
  const [error, setError] = useState<unknown>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api.get<PrizeDeskResponse>(`/admin/daily-quiz/winners?view=${view}&page=${page}&limit=20`))
    } catch (err) {
      setError(err)
    }
  }, [view, page])

  useEffect(() => {
    void load()
  }, [load])

  function replace(updated: QuizWinnerRow) {
    setData((current) =>
      current ? { ...current, winners: current.winners.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)) } : current,
    )
    onChanged()
  }

  return (
    <Card>
      <CardHeader
        title="Prize desk"
        as="h2"
        size="sm"
        description="Every winner a person still has to act on — announce, call the parent or guardian, deliver — across every month and band. Candidates are worked out on the Monthly winners tab."
      />
      <Tabs
        idPrefix="prize-desk"
        label="Which winners"
        mode="filter"
        variant="pill"
        value={view}
        onChange={(next) => {
          setView(next as PrizeDeskView)
          setPage(1)
        }}
        items={DESK_VIEWS.map((item) => ({ id: item.id, label: item.label }))}
      />
      {error !== null ? (
        <ErrorState title="Could not load the prize desk" error={error} onRetry={() => void load()} />
      ) : !data ? (
        <SkeletonTable rows={4} />
      ) : data.winners.length === 0 ? (
        <EmptyState
          size="sm"
          icon="ph-gift"
          title={view === 'outstanding' ? 'Nothing waiting' : 'No winners here yet'}
          description={
            view === 'outstanding'
              ? 'Every confirmed winner has been announced and every announced prize delivered.'
              : 'Winners appear here once they are confirmed on the Monthly winners tab.'
          }
        />
      ) : (
        <>
          <WinnerTable rows={data.winners} onChanged={replace} showQuiz label="Winners across every month and band" />
          {data.pagination.totalPages > 1 && (
            <Pagination page={page} pageCount={data.pagination.totalPages} total={data.pagination.total} pageSize={20} onChange={setPage} label="Winner pages" />
          )}
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** The most reminders a day the server accepts — the email provider's whole free daily quota. */
const REMINDER_CAP_MAX = 300

interface SettingsResponse {
  settings: QuizSettings
  /** Whether the server has `JOBS_SECRET`, without which no reminder is offered or sent. */
  scheduler?: { configured: boolean }
}

/**
 * "Last run Fri, 9 Oct 2026 • 7:00 AM: 42 queued, of 47 who asked for one. Skipped: 5 already
 * started, 0 already reminded today, 0 over the daily limit." — read off the job's own record.
 * The time is India time (`formatDateTime`), and the run is always for that day's quiz. Worded
 * so a count of one reads as correctly as a count of forty.
 */
function describeRun(run: ReminderRun): string {
  const when = `Last run ${formatDateTime(run.at)}`
  if (!run.enabled) return `${when}: reminders were switched off, so none were sent.`
  const skipped = [
    `${formatNumber(run.alreadyStarted)} already started`,
    `${formatNumber(run.alreadyReminded)} already reminded today`,
    `${formatNumber(run.overCap)} over the daily limit`,
  ]
  if (run.failed > 0) skipped.push(`${formatNumber(run.failed)} could not be queued`)
  return `${when}: ${formatNumber(run.queued)} queued, of ${formatNumber(run.eligible)} who asked for one. Skipped: ${skipped.join(', ')}.`
}

function SettingsForm() {
  const toast = useToast()
  const [settings, setSettings] = useState<QuizSettings | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cash, setCash] = useState('')
  const [cap, setCap] = useState('')
  const [schedulerConfigured, setSchedulerConfigured] = useState<boolean | null>(null)
  const [published, setPublished] = useState<QuizPrizeInfo | null>(null)

  /** The public sentence, as the site prints it. A fresh query string, because the public route caches for a minute. */
  const loadPublished = useCallback(async () => {
    try {
      setPublished((await api.get<{ info: QuizPrizeInfo }>(`/daily-quiz/info?at=${Date.now()}`)).info)
    } catch {
      setPublished(null)
    }
  }, [])

  useEffect(() => {
    api
      .get<SettingsResponse>('/admin/daily-quiz/settings')
      .then((res) => {
        setSettings(res.settings)
        setCash(res.settings.cashAmount === null ? '' : String(res.settings.cashAmount))
        setCap(res.settings.reminderDailyCap === undefined ? '' : String(res.settings.reminderDailyCap))
        setSchedulerConfigured(res.scheduler?.configured ?? null)
      })
      .catch(setError)
    void loadPublished()
  }, [loadPublished])

  // A backend older than Phase 7b reports no reminder settings (the two apps deploy separately):
  // the section is then left out, and a save sends only what that backend knows.
  const remindersSupported = typeof settings?.reminderDailyCap === 'number'

  if (error) return <ErrorState title="Could not load the settings" error={error} />
  if (!settings) {
    return (
      <Card>
        <SkeletonText lines={6} label="Loading the settings" />
      </Card>
    )
  }

  const cashValue = cash.trim() === '' ? null : Number(cash)
  const cashInvalid = cashValue !== null && (!Number.isInteger(cashValue) || cashValue < 0 || cashValue > 100000)
  const capValue = Number(cap)
  const capInvalid =
    remindersSupported && (cap.trim() === '' || !Number.isInteger(capValue) || capValue < 0 || capValue > REMINDER_CAP_MAX)

  async function save() {
    if (!settings || cashInvalid || capInvalid) return
    setBusy(true)
    setSaveError(null)
    try {
      const res = await api.put<SettingsResponse>('/admin/daily-quiz/settings', {
        prizeHeadline: settings.prizeHeadline,
        prizeText: settings.prizeText,
        cashAmount: cashValue,
        instantResult: settings.instantResult,
        ...(remindersSupported ? { remindersEnabled: settings.remindersEnabled, reminderDailyCap: capValue } : {}),
      })
      setSettings(res.settings)
      setCap(res.settings.reminderDailyCap === undefined ? '' : String(res.settings.reminderDailyCap))
      toast.success('Daily Quiz settings saved.')
      void loadPublished()
    } catch (err) {
      setSaveError(humanizeError(err, { fallback: 'The settings could not be saved.' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Prize"
        as="h2"
        size="sm"
        description={
          settings.updatedAt
            ? `Last changed ${formatDateTime(settings.updatedAt)}${settings.updatedByLabel ? ` by ${settings.updatedByLabel}` : ''}.`
            : 'Using the launch defaults.'
        }
      />
      {/* A form, so Enter in any field saves (Milestone 30, Phase 5). */}
      <form
        className={styles.stack}
        onSubmit={(event) => {
          event.preventDefault()
          void save()
        }}
      >
        <div className={styles.formGrid}>
          <Field label="Prize headline" hint="Shown in the Rewards section and on the sign-in prompt.">
            <Input value={settings.prizeHeadline} maxLength={80} onChange={(event) => setSettings({ ...settings, prizeHeadline: event.target.value })} />
          </Field>
          <Field label="Prize, in words" hint="For example “a surprise gift and a cash prize”.">
            <Input value={settings.prizeText} maxLength={120} onChange={(event) => setSettings({ ...settings, prizeText: event.target.value })} />
          </Field>
          <Field
            label="Cash amount (₹)"
            optional
            error={cashInvalid ? 'A whole number of rupees, up to 1,00,000 — or leave it blank.' : undefined}
            hint="Leave blank to say only “cash prize”. A figure is shown everywhere the prize is, so set it only when it is decided."
          >
            <Input inputMode="numeric" value={cash} onChange={(event) => setCash(event.target.value)} />
          </Field>
        </div>
        <Checkbox
          label="Show right or wrong as soon as an answer is submitted"
          description="The correct option and the solution always wait until the next day. Turned off, the result itself waits too — which makes finding the answer with several accounts harder."
          checked={settings.instantResult}
          onChange={(event) => setSettings({ ...settings, instantResult: event.target.checked })}
        />
        <Alert tone="info" title="How winners are chosen — what the site says">
          {published ? published.howWinnersAreChosen : 'The public wording could not be loaded.'} The rule is fixed: one winner a month in
          each class band, four prizes a month. The prize above is what each winner is told they have won.
        </Alert>

        {/* The 7:00 AM reminder emails (Milestone 30 Phase 7b). */}
        {remindersSupported && (
          <>
            <h3 className={styles.settingsHeading}>Reminder emails</h3>
            <Checkbox
              label="Send reminder emails"
              description="At 7:00 AM, to students who asked for one, on days their class has a quiz they have not started. Each student turns reminders on for themselves — this switch sends nothing on its own."
              checked={settings.remindersEnabled === true}
              onChange={(event) => setSettings({ ...settings, remindersEnabled: event.target.checked })}
            />
            <div className={styles.formGrid}>
              <Field
                label="Most reminders a day"
                error={capInvalid ? `A whole number from 0 to ${REMINDER_CAP_MAX}.` : undefined}
                hint={`0 to ${REMINDER_CAP_MAX}. The email provider's free quota (300 a day) is shared with sign-up and password emails, so keep room for them.`}
              >
                <Input inputMode="numeric" value={cap} onChange={(event) => setCap(event.target.value)} />
              </Field>
            </div>
            {schedulerConfigured === false && (
              <Alert tone="warning" title="The scheduler is not set up">
                The server has no JOBS_SECRET, so no reminder is offered to students or sent. The launch report has the steps.
              </Alert>
            )}
            <p className={styles.lastRun}>
              {settings.lastReminderRun ? describeRun(settings.lastReminderRun) : 'Not run yet — the scheduler has not called it.'}
            </p>
          </>
        )}

        {saveError && <Alert tone="danger">{saveError}</Alert>}
        <div className={styles.inlineActions}>
          <Button type="submit" icon="ph-floppy-disk" loading={busy} disabled={cashInvalid || capInvalid}>
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  )
}
