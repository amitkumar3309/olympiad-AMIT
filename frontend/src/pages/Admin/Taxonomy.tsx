import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import type { Subject, TaxonomyStatus, Topic } from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import styles from './Taxonomy.module.css'

/**
 * Chapters and subtopics — the classification every question is filed under.
 *
 * ## There is no subject management here any more (Milestone 21, Phase J)
 *
 * This page used to create, archive and list **subjects**, with chapters nested inside them. AMIT is
 * a mathematics olympiad: the subject is implicit, so managing a list of one was work nobody needed
 * to do and a concept nobody needed to learn.
 *
 * `Subject` still exists on the backend — `Topic` is scoped by it and `Question.subject` is a real
 * field — so this page resolves it once and files everything under it. That keeps the architecture
 * open to a second subject later without putting the idea in front of an administrator now. If one
 * is ever wanted, the honest change is a new page, not resurrecting a dropdown of one item.
 *
 * ## Chapters and subtopics are the same collection
 *
 * They are distinguished by their parent, so this renders one nested list rather than two tabs —
 * the shape of the UI matches the shape of the data. Two levels, no deeper.
 */
export default function Taxonomy() {
  const [subject, setSubject] = useState<Subject | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')

  const [showArchived, setShowArchived] = useState(false)
  const [newTopic, setNewTopic] = useState<{ parent: string | null; name: string }>({ parent: null, name: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = showArchived ? '' : '?status=active'
      const [subjectRes, topicRes] = await Promise.all([
        api.get<{ subjects: Subject[] }>('/subjects?status=active'),
        api.get<{ topics: Topic[] }>(`/topics${query}`),
      ])

      /**
       * The one subject, resolved rather than chosen.
       *
       * Prefers one actually named for mathematics, because legacy data may still hold a second —
       * the backend's `findImplicitSubject()` makes the same choice for the same reason, and the two
       * must agree about where a new chapter goes.
       */
      const subjects = subjectRes.subjects
      const maths = subjects.find((entry) => /^(math|maths|mathematics)$/i.test(entry.name.trim()))
      setSubject(maths ?? subjects[0] ?? null)
      setTopics(topicRes.topics)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the chapters.')
      setSubject(null)
      setTopics([])
    } finally {
      setLoading(false)
    }
  }, [showArchived])

  useEffect(() => {
    void load()
  }, [load])

  async function createTopic(e: FormEvent) {
    e.preventDefault()
    const name = newTopic.name.trim()
    if (!name || !subject) return

    setBusy('topic')
    setError('')
    setNotice('')
    try {
      // The subject is supplied from the resolved one, never chosen: there is nothing to choose.
      await api.post<{ topic: Topic }>('/admin/topics', {
        subject: subject.id,
        parent: newTopic.parent,
        name,
      })
      setNewTopic({ parent: null, name: '' })
      setNotice(`${newTopic.parent ? 'Subtopic' : 'Chapter'} "${name}" created.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that chapter.')
    } finally {
      setBusy('')
    }
  }

  async function setTopicStatus(topic: Topic, status: TaxonomyStatus) {
    setBusy(topic.id)
    setError('')
    setNotice('')
    try {
      await api.patch<{ topic: Topic }>(`/admin/topics/${topic.id}`, { status })
      setNotice(`"${topic.name}" ${status === 'archived' ? 'archived' : 'reactivated'}.`)
      await load()
    } catch (err) {
      // The backend refuses to archive anything with published questions still filed under it, and
      // says how many — surface that message verbatim.
      setError(err instanceof ApiError ? err.message : 'Could not update that chapter.')
    } finally {
      setBusy('')
    }
  }

  const chapters = topics.filter((topic) => topic.parent === null)
  const childrenOf = (parentId: string) => topics.filter((topic) => topic.parent === parentId)

  return (
    <AdminShell title="Chapters">
      <p className={styles.intro}>
        The classification every question is filed under. A chapter may contain subtopics — two levels, no deeper. Names
        are plain text, not formulas. Nothing here is deleted: archiving keeps existing questions readable, and is refused
        while published questions still point at the entry.
      </p>

      <label className={styles.archivedToggle}>
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        entries
      </label>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className="error-text">{error}</p>}

      <div className={styles.forms}>
        <form className={styles.inlineForm} onSubmit={createTopic}>
          <label htmlFor="new-topic-name">New chapter or subtopic</label>
          <div className={styles.inlineRow}>
            <select
              className="form-control"
              value={newTopic.parent ?? ''}
              onChange={(e) => setNewTopic({ ...newTopic, parent: e.target.value === '' ? null : e.target.value })}
              aria-label="Parent chapter (leave blank for a top-level chapter)"
            >
              <option value="">Top-level chapter</option>
              {chapters
                .filter((topic) => topic.status === 'active')
                .map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    Subtopic of {topic.name}
                  </option>
                ))}
            </select>
            <input
              id="new-topic-name"
              className="form-control"
              value={newTopic.name}
              onChange={(e) => setNewTopic({ ...newTopic, name: e.target.value })}
              placeholder="e.g. Quadratic Equations"
              aria-label="Name of the new chapter"
            />
            <Button type="submit" disabled={busy === 'topic' || !subject || !newTopic.name.trim()}>
              Add
            </Button>
          </div>
        </form>
      </div>

      {loading ? (
        <div className={styles.centered}>
          <Spinner />
          <p>Loading chapters…</p>
        </div>
      ) : !subject ? (
        <div className={styles.empty}>
          <p>This deployment has no subject set up.</p>
          <p className={styles.emptyHint}>
            A chapter has to belong to something. This is a first-run condition rather than anything you can fix here —
            seed the database, or ask whoever set it up.
          </p>
        </div>
      ) : chapters.length === 0 ? (
        <div className={styles.empty}>
          <p>No chapters yet.</p>
          <p className={styles.emptyHint}>
            Add one above — questions cannot be created until at least one chapter exists.
          </p>
        </div>
      ) : (
        <ul className={styles.topics}>
          {chapters.map((topic) => {
            const subtopics = childrenOf(topic.id)
            return (
              <li key={topic.id} className={busy === topic.id ? styles.busy : undefined}>
                <div className={styles.topicRow}>
                  <span className={styles.topicName}>{topic.name}</span>
                  {topic.status === 'archived' && <span className={styles.archivedBadge}>archived</span>}
                  {subtopics.length > 0 && (
                    <span className={styles.topicCount}>
                      {subtopics.length} subtopic{subtopics.length === 1 ? '' : 's'}
                    </span>
                  )}
                  <button
                    type="button"
                    className={styles.linkButton}
                    disabled={busy === topic.id}
                    onClick={() => void setTopicStatus(topic, topic.status === 'archived' ? 'active' : 'archived')}
                  >
                    {topic.status === 'archived' ? 'Reactivate' : 'Archive'}
                  </button>
                </div>

                {subtopics.length > 0 && (
                  <ul className={styles.subtopics}>
                    {subtopics.map((sub) => (
                      <li key={sub.id} className={busy === sub.id ? styles.busy : undefined}>
                        <div className={styles.topicRow}>
                          <span className={styles.subtopicName}>{sub.name}</span>
                          {sub.status === 'archived' && <span className={styles.archivedBadge}>archived</span>}
                          <button
                            type="button"
                            className={styles.linkButton}
                            disabled={busy === sub.id}
                            onClick={() => void setTopicStatus(sub, sub.status === 'archived' ? 'active' : 'archived')}
                          >
                            {sub.status === 'archived' ? 'Reactivate' : 'Archive'}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </AdminShell>
  )
}
