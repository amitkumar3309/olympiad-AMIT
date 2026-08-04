import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import type { Subject, TaxonomyStatus, Topic } from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import styles from './Taxonomy.module.css'

/**
 * Subject / topic / subtopic management.
 *
 * Topics and subtopics are the same entity on the backend, distinguished by their
 * parent, so this page renders them as one nested list rather than two tabs — the
 * shape of the UI matches the shape of the data.
 */
export default function Taxonomy() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [topicsBySubject, setTopicsBySubject] = useState<Record<string, Topic[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState('')

  const [showArchived, setShowArchived] = useState(false)
  const [expanded, setExpanded] = useState<string>('')

  const [newSubject, setNewSubject] = useState('')
  const [newTopic, setNewTopic] = useState<{ subject: string; parent: string | null; name: string }>({
    subject: '',
    parent: null,
    name: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const subjectQuery = showArchived ? '' : '?status=active'
      const [subjectRes, topicRes] = await Promise.all([
        api.get<{ subjects: Subject[] }>(`/subjects${subjectQuery}`),
        api.get<{ topics: Topic[] }>(`/topics${showArchived ? '' : '?status=active'}`),
      ])

      setSubjects(subjectRes.subjects)

      // Group every topic (both levels) by subject in one pass, so the tree can be
      // rendered without a request per subject.
      const grouped: Record<string, Topic[]> = {}
      for (const topic of topicRes.topics) {
        grouped[topic.subject] = [...(grouped[topic.subject] ?? []), topic]
      }
      setTopicsBySubject(grouped)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load subjects and topics.')
      setSubjects([])
      setTopicsBySubject({})
    } finally {
      setLoading(false)
    }
  }, [showArchived])

  useEffect(() => {
    void load()
  }, [load])

  async function createSubject(e: FormEvent) {
    e.preventDefault()
    const name = newSubject.trim()
    if (!name) return

    setBusy('subject')
    setError('')
    setNotice('')
    try {
      await api.post<{ subject: Subject }>('/admin/subjects', { name })
      setNewSubject('')
      setNotice(`Subject "${name}" created.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that subject.')
    } finally {
      setBusy('')
    }
  }

  async function createTopic(e: FormEvent) {
    e.preventDefault()
    const name = newTopic.name.trim()
    if (!name || !newTopic.subject) return

    setBusy('topic')
    setError('')
    setNotice('')
    try {
      await api.post<{ topic: Topic }>('/admin/topics', {
        subject: newTopic.subject,
        parent: newTopic.parent,
        name,
      })
      setNewTopic({ subject: '', parent: null, name: '' })
      setNotice(`${newTopic.parent ? 'Subtopic' : 'Topic'} "${name}" created.`)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create that topic.')
    } finally {
      setBusy('')
    }
  }

  async function setSubjectStatus(subject: Subject, status: TaxonomyStatus) {
    setBusy(subject.id)
    setError('')
    setNotice('')
    try {
      await api.patch<{ subject: Subject }>(`/admin/subjects/${subject.id}`, { status })
      setNotice(`"${subject.name}" ${status === 'archived' ? 'archived' : 'reactivated'}.`)
      await load()
    } catch (err) {
      // The backend refuses to archive anything with published questions still
      // filed under it, and says how many — surface that message verbatim.
      setError(err instanceof ApiError ? err.message : 'Could not update that subject.')
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
      setError(err instanceof ApiError ? err.message : 'Could not update that topic.')
    } finally {
      setBusy('')
    }
  }

  function topLevel(subjectId: string): Topic[] {
    return (topicsBySubject[subjectId] ?? []).filter((t) => t.parent === null)
  }

  function childrenOf(subjectId: string, parentId: string): Topic[] {
    return (topicsBySubject[subjectId] ?? []).filter((t) => t.parent === parentId)
  }

  return (
    <AdminShell title="Subjects & Topics">
      <p className={styles.intro}>
        The classification every question is filed under. A subject contains topics, and a topic may contain subtopics — two
        levels, no deeper. Names are plain text, not formulas. Nothing here is deleted: archiving keeps existing questions
        readable, and is refused while published questions still point at the entry.
      </p>

      <label className={styles.archivedToggle}>
        <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
        entries
      </label>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <p className="error-text">{error}</p>}

      <div className={styles.forms}>
        <form className={styles.inlineForm} onSubmit={createSubject}>
          <label htmlFor="new-subject">New subject</label>
          <div className={styles.inlineRow}>
            <input
              id="new-subject"
              className="form-control"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder="e.g. Number Theory"
            />
            <Button type="submit" disabled={busy === 'subject' || !newSubject.trim()}>
              Add
            </Button>
          </div>
        </form>

        <form className={styles.inlineForm} onSubmit={createTopic}>
          <label htmlFor="new-topic-subject">New topic or subtopic</label>
          <div className={styles.inlineRow}>
            <select
              id="new-topic-subject"
              className="form-control"
              value={newTopic.subject}
              onChange={(e) => setNewTopic({ subject: e.target.value, parent: null, name: newTopic.name })}
              aria-label="Subject for the new topic"
            >
              <option value="">Subject…</option>
              {subjects
                .filter((s) => s.status === 'active')
                .map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
            </select>
            <select
              className="form-control"
              value={newTopic.parent ?? ''}
              onChange={(e) => setNewTopic({ ...newTopic, parent: e.target.value === '' ? null : e.target.value })}
              disabled={!newTopic.subject}
              aria-label="Parent topic (leave blank for a top-level topic)"
            >
              <option value="">Top-level topic</option>
              {topLevel(newTopic.subject).map((topic) => (
                <option key={topic.id} value={topic.id}>
                  Subtopic of {topic.name}
                </option>
              ))}
            </select>
            <input
              className="form-control"
              value={newTopic.name}
              onChange={(e) => setNewTopic({ ...newTopic, name: e.target.value })}
              placeholder="e.g. Quadratic Equations"
              aria-label="Name of the new topic"
            />
            <Button type="submit" disabled={busy === 'topic' || !newTopic.subject || !newTopic.name.trim()}>
              Add
            </Button>
          </div>
        </form>
      </div>

      {loading ? (
        <div className={styles.centered}>
          <Spinner />
          <p>Loading subjects and topics…</p>
        </div>
      ) : subjects.length === 0 ? (
        <div className={styles.empty}>
          <p>No subjects yet.</p>
          <p className={styles.emptyHint}>
            Add a subject above — questions cannot be created until at least one subject and one topic exist.
          </p>
        </div>
      ) : (
        <ul className={styles.tree}>
          {subjects.map((subject) => {
            const topics = topLevel(subject.id)
            return (
              <li key={subject.id} className={`${styles.subject} ${busy === subject.id ? styles.busy : ''}`}>
                <div className={styles.subjectHead}>
                  <button type="button" className={styles.disclosure} onClick={() => setExpanded(expanded === subject.id ? '' : subject.id)}>
                    {expanded === subject.id ? '▾' : '▸'}
                  </button>
                  <span className={styles.subjectName}>{subject.name}</span>
                  <span className={styles.slug}>{subject.slug}</span>
                  {subject.status === 'archived' && <span className={styles.archivedBadge}>archived</span>}
                  <span className={styles.topicCount}>
                    {topics.length} topic{topics.length === 1 ? '' : 's'}
                  </span>
                  <button
                    type="button"
                    className={styles.linkButton}
                    disabled={busy === subject.id}
                    onClick={() => void setSubjectStatus(subject, subject.status === 'archived' ? 'active' : 'archived')}
                  >
                    {subject.status === 'archived' ? 'Reactivate' : 'Archive'}
                  </button>
                </div>

                {expanded === subject.id && (
                  <>
                    {topics.length === 0 ? (
                      <p className={styles.noTopics}>No topics under this subject yet.</p>
                    ) : (
                      <ul className={styles.topics}>
                        {topics.map((topic) => {
                          const subtopics = childrenOf(subject.id, topic.id)
                          return (
                            <li key={topic.id} className={busy === topic.id ? styles.busy : undefined}>
                              <div className={styles.topicRow}>
                                <span className={styles.topicName}>{topic.name}</span>
                                {topic.status === 'archived' && <span className={styles.archivedBadge}>archived</span>}
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
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </AdminShell>
  )
}
