import { useCallback, useEffect, useState } from 'react'
import StudentShell from '../../components/StudentShell'
import { ActivityList, Button, Card, EmptyState, ErrorState, SkeletonText } from '../../components/ui'
import { api } from '../../api/client'
import type { ActivityEntry, Pagination } from '../../api/types'
import { activityIcon, activityTitle } from '../../lib/activity'
import { formatDayLabel, formatNumber, formatTime } from '../../lib/format'
import styles from './Activity.module.css'

/**
 * Everything the student has done, with the XP each event earned, newest first
 * (Milestone 30, Phase 4) — where the dashboard's "Recent activity → View all" leads. The
 * dashboard shows the newest three; this pages the same log from `GET /me/activity`.
 *
 * "Today" and "Yesterday" are read against today's IST date — a caption, not a deadline.
 */

const PAGE_SIZE = 20

function istToday(): string {
  return new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10)
}

export default function Activity() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [pagesLoaded, setPagesLoaded] = useState(0)
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [today] = useState(istToday)

  const loadPage = useCallback(async (page: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get<{ entries: ActivityEntry[]; pagination: Pagination }>(
        `/me/activity?page=${page}&limit=${PAGE_SIZE}`,
      )
      setEntries((current) => (page === 1 ? res.entries : [...current, ...res.entries]))
      setPagesLoaded(page)
      setTotal(res.pagination.total)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPage(1)
  }, [loadPage])

  const hasMore = total !== null && entries.length < total

  return (
    <StudentShell
      title="Your activity"
      subtitle={total !== null ? `${formatNumber(total)} ${total === 1 ? 'event' : 'events'}, newest first, with the XP each one earned.` : undefined}
    >
      {error !== null && entries.length === 0 ? (
        <ErrorState error={error} titleAs="h2" onRetry={() => void loadPage(1)} />
      ) : loading && entries.length === 0 ? (
        <Card>
          <SkeletonText lines={8} label="Loading your activity" />
        </Card>
      ) : entries.length === 0 ? (
        <EmptyState
          titleAs="h2"
          icon="ph-list-dashes"
          title="Nothing recorded yet"
          description="Practice, mock tests and the Daily Quiz all appear here as you go, with the XP each one earned."
        />
      ) : (
        <Card>
          <ActivityList
            items={entries.map((entry) => {
              return {
                key: entry.id,
                icon: activityIcon(entry),
                tone: entry.xpAwarded > 0 ? 'green' : 'blue',
                title: activityTitle(entry),
                time: `${formatDayLabel(entry.occurredOn, today)}, ${formatTime(entry.createdAt)}`,
                value: entry.xpAwarded > 0 ? `+${formatNumber(entry.xpAwarded)} XP` : undefined,
              }
            })}
          />
          {/* A failed "load more" keeps what is on screen and offers the button again. */}
          {error !== null && <p className={styles.error}>Could not load more. Try again.</p>}
          {hasMore && (
            <div className={styles.more}>
              <Button variant="secondary" loading={loading} onClick={() => void loadPage(pagesLoaded + 1)}>
                {loading ? 'Loading' : 'Show earlier activity'}
              </Button>
            </div>
          )}
          {!hasMore && total !== null && total > PAGE_SIZE && (
            <p className={styles.end}>That is your whole history.</p>
          )}
        </Card>
      )}
    </StudentShell>
  )
}
