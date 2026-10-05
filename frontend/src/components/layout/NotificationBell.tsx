import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../api/client'
import type { DailyQuizStatus, InboxNotification } from '../../api/types'
import { formatTimeAgo } from '../../lib/format'
import { Icon, Menu, type MenuItem } from '../ui'
import styles from './NotificationBell.module.css'

/**
 * The student top bar's bell (Milestone 30, Phase 4 — brief §8 #11): the unread count, and
 * a menu of the newest notices.
 *
 * ## Fetched when opened, not on every page
 *
 * The shell already asks for the unread *count* on each navigation (one indexed count);
 * the list itself is fetched only when somebody opens the menu, so a student who never
 * does costs nothing. Each opening asks again, so the list is never stale.
 *
 * ## What it lists
 *
 * The newest five stored notifications (results, winners, announcements — the inbox's own
 * audience rules decide which), unread ones set heavier **and** labelled "Unread" in words.
 * Above them, when it is true, one item the inbox does not hold: **today's Daily Quiz is
 * live** — derived from `GET /me/daily-quiz/status` rather than stored, because it stops
 * being true at midnight. It is not counted in the badge, which counts stored notices only.
 *
 * Choosing a notice marks it read and opens what it is about (its `link`, or the inbox).
 */

const LIST_LIMIT = 5

export interface NotificationBellProps {
  unread: number
  /** Asks the shell to re-read the count, after a notice is marked read here. */
  onChange?: () => void
}

type Loaded = { notifications: InboxNotification[]; quizLive: boolean } | 'failed' | null

export default function NotificationBell({ unread, onChange }: NotificationBellProps) {
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<Loaded>(null)

  const onOpenChange = useCallback((open: boolean) => {
    if (!open) return
    setLoaded(null)
    void Promise.all([
      api.get<{ notifications: InboxNotification[] }>(`/me/notifications?limit=${LIST_LIMIT}`),
      // A failed status is not worth failing the list over.
      api.get<DailyQuizStatus>('/me/daily-quiz/status').catch(() => null),
    ])
      .then(([inbox, status]) => setLoaded({ notifications: inbox.notifications, quizLive: status?.state === 'live' }))
      .catch(() => setLoaded('failed'))
  }, [])

  /*
    The menu focuses its first enabled item when it opens — which, while the list is still
    loading, is "View all". Once the list arrives, focus moves to its first entry, but only
    if it is still inside the menu (the reader has not gone elsewhere meanwhile).
  */
  useEffect(() => {
    if (loaded === null || loaded === 'failed') return
    const menu = document.activeElement?.closest('[role="menu"]')
    menu?.querySelector<HTMLElement>('[data-menu-item]:not([aria-disabled="true"])')?.focus()
  }, [loaded])

  async function openNotice(notice: InboxNotification) {
    if (!notice.read) {
      try {
        await api.post(`/me/notifications/${notice.id}/read`)
      } catch {
        // Opening it matters more than the read mark; the inbox can mark it later.
      }
      onChange?.()
    }
    navigate(notice.link ?? '/notifications')
  }

  const items: MenuItem[] = []
  if (loaded === null) {
    items.push({ label: 'Loading…', disabled: true, id: 'loading' })
  } else if (loaded === 'failed') {
    items.push({ label: 'Notifications could not be loaded', disabled: true, disabledReason: 'Close this and try again.', id: 'failed' })
  } else {
    if (loaded.quizLive) {
      items.push({
        id: 'quiz-live',
        label: 'Today’s Daily Quiz is live',
        meta: 'Answer before midnight to be in the running',
        icon: 'ph-lightning',
        emphasis: true,
        to: '/daily-quiz',
      })
    }
    for (const notice of loaded.notifications) {
      const when = notice.publishedAt ? formatTimeAgo(notice.publishedAt) : null
      items.push({
        id: notice.id,
        label: notice.title,
        meta: [notice.read ? null : 'Unread', when].filter(Boolean).join(' · ') || undefined,
        emphasis: !notice.read,
        icon: notice.read ? 'ph-bell' : 'ph-bell-ringing',
        onSelect: () => void openNotice(notice),
      })
    }
  }

  if (items.length > 0) items.push({ separator: true })
  items.push({
    id: 'all',
    label: 'View all notifications',
    icon: 'ph-arrow-right',
    to: '/notifications',
    meta: loaded !== null && loaded !== 'failed' && loaded.notifications.length === 0 ? 'Nothing yet — you are all caught up.' : undefined,
  })

  const name = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'

  return (
    <Menu
      label={name}
      align="end"
      onOpenChange={onOpenChange}
      items={items}
      className={styles.trigger}
      trigger={
        <span className={styles.bell}>
          <Icon name={unread > 0 ? 'ph-bell-ringing' : 'ph-bell'} weight="bold" size="md" />
          {unread > 0 && (
            // The count is in the button's name; this is its picture.
            <span className={styles.count} aria-hidden="true">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </span>
      }
    />
  )
}
