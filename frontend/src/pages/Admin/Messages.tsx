import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import type { ContactMessage, ContactMessagesResponse } from '../../api/types'
import AdminShell from './AdminShell'
import { Badge, Button, Card, EmptyState, ErrorState, Pagination, SkeletonText, Tabs, useToast } from '../../components/ui'
import { formatDateTime } from '../../lib/format'
import { humanizeError } from '../../lib/errors'
import styles from './Messages.module.css'

/**
 * Admin → Messages (2026-10-13): what visitors sent through the Contact page's form, newest
 * first. Every message is here whether or not its notification email went out — the email
 * stops at a daily cap. Reply from your own mailbox, then mark it handled.
 */

const VIEWS = [
  { id: 'new', label: 'To answer' },
  { id: 'handled', label: 'Handled' },
  { id: 'all', label: 'All' },
] as const
type View = (typeof VIEWS)[number]['id']

export default function AdminMessages() {
  const toast = useToast()
  const [view, setView] = useState<View>('new')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ContactMessagesResponse | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api.get<ContactMessagesResponse>(`/admin/contact-messages?status=${view}&page=${page}&limit=20`))
    } catch (err) {
      setError(err)
    }
  }, [view, page])

  useEffect(() => {
    void load()
  }, [load])

  async function mark(message: ContactMessage, status: 'new' | 'handled') {
    setBusyId(message.id)
    try {
      await api.patch(`/admin/contact-messages/${message.id}`, { status })
      toast.success(status === 'handled' ? 'Marked as handled.' : 'Moved back to “To answer”.')
      await load()
    } catch (err) {
      toast.error(humanizeError(err, { fallback: 'The message could not be updated.' }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <AdminShell
      title="Messages"
      subtitle={data ? `${data.unhandled} to answer. Reply by email from your own mailbox, then mark the message handled.` : 'From the Contact page.'}
    >
      <Tabs
        idPrefix="messages"
        label="Which messages"
        mode="filter"
        variant="pill"
        value={view}
        onChange={(next) => {
          setView(next as View)
          setPage(1)
        }}
        items={VIEWS.map((item) => ({ id: item.id, label: item.label }))}
      />
      {error !== null ? (
        <ErrorState titleAs="h2" title="Could not load the messages" error={error} onRetry={() => void load()} />
      ) : !data ? (
        <Card>
          <SkeletonText lines={6} label="Loading the messages" />
        </Card>
      ) : data.messages.length === 0 ? (
        <EmptyState
          titleAs="h2"
          icon="ph-envelope-simple-open"
          title={view === 'new' ? 'Nothing to answer' : 'No messages here'}
          description="Messages sent through the Contact page's form appear here."
        />
      ) : (
        <div className={styles.list}>
          {data.messages.map((message) => (
            <Card key={message.id} as="article" className={styles.message}>
              <div className={styles.head}>
                <h2 className={styles.from}>{message.name}</h2>
                <Badge tone={message.status === 'new' ? 'warning' : 'success'}>{message.status === 'new' ? 'To answer' : 'Handled'}</Badge>
              </div>
              <p className={styles.meta}>
                <a href={`mailto:${message.email}`}>{message.email}</a> · {message.topicLabel} · {formatDateTime(message.createdAt)}
                {message.fromAccount ? ' · signed in' : ''}
                {message.emailed ? '' : ' · not emailed (daily limit)'}
              </p>
              <p className={styles.body}>{message.message}</p>
              <div className={styles.actions}>
                {message.status === 'new' ? (
                  <Button size="sm" icon="ph-check" loading={busyId === message.id} onClick={() => void mark(message, 'handled')}>
                    Mark handled
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" loading={busyId === message.id} onClick={() => void mark(message, 'new')}>
                    Move back to “To answer”
                  </Button>
                )}
                {message.handledByLabel && message.handledAt && (
                  <span className={styles.meta}>
                    Handled by {message.handledByLabel}, {formatDateTime(message.handledAt)}
                  </span>
                )}
              </div>
            </Card>
          ))}
          <Pagination
            page={page}
            pageCount={data.pagination.totalPages}
            total={data.pagination.total}
            pageSize={data.pagination.limit}
            onChange={setPage}
            label="Message pages"
          />
        </div>
      )}
    </AdminShell>
  )
}
