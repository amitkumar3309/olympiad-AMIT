import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useAuth } from '../context/AuthContext'
import Spinner from './Spinner'
import { Icon } from './ui'
import styles from './ResetPanel.module.css'

/**
 * The danger zone: one button per administrative area that empties it (Milestone 22).
 *
 * Shared by the Question Bank, Mock Tests, Daily Challenges and Chapters rather than
 * written four times, because a confirmation flow copied four times is a confirmation flow
 * that is weaker in one of them — and the one it is weakest in is the one somebody presses
 * by accident.
 *
 * ## What stands between a click and an empty collection
 *
 * 1. **It is not rendered at all without `content:reset`**, which only the super admin
 *    holds. That is presentation, not protection — the server refuses regardless — but a
 *    button that always 403s is worse than no button.
 * 2. **Nothing happens on the first press.** It opens a dialog that has to fetch the real
 *    counts first, so the administrator is reading "3,201 questions" rather than a generic
 *    warning.
 * 3. **The exact phrase must be typed.** Not "yes", not a second click: `RESET QUESTIONS`.
 *    The phrase differs per area, so muscle memory from one dialog cannot confirm another.
 * 4. **Blockers replace the confirmation entirely.** When a reset would orphan rows there
 *    is no input to type into and no button to press — only what to do first.
 *
 * The dialog deliberately shows what will **survive** as well as what will go. Half the
 * hesitation at this point is "will this take away the students' XP?", and the honest
 * answer — no, and here is the list — is what makes the button usable rather than
 * something staff avoid and work around.
 */

export type ResetScope = 'questions' | 'mock-tests' | 'daily-challenges' | 'chapters'

interface ResetLine {
  label: string
  count: number
  /** The count and its noun, already agreeing — built server-side. Display this. */
  text: string
  note?: string
}

interface ResetBlocker {
  label: string
  count: number
  resolveWith: ResetScope | null
}

interface ResetPreview {
  scope: ResetScope
  label: string
  confirmPhrase: string
  deletes: ResetLine[]
  preserves: string[]
  blockers: ResetBlocker[]
  canReset: boolean
  totalToDelete: number
}

interface ResetPanelProps {
  scope: ResetScope
  /**
   * Called after a successful reset so the page can reload. The panel does not reload
   * anything itself: it has no idea what the page around it is showing.
   */
  onDone?: () => void
}

const SCOPE_TITLES: Record<ResetScope, string> = {
  questions: 'Reset the Question Bank',
  'mock-tests': 'Reset all mock tests',
  'daily-challenges': 'Reset all daily challenges',
  chapters: 'Reset all chapters',
}

const SCOPE_BLURBS: Record<ResetScope, string> = {
  questions: 'Deletes every question — published, draft, in review and archived. Chapters are kept.',
  'mock-tests': 'Deletes every mock test and every attempt students have made at one.',
  'daily-challenges': 'Deletes every scheduled challenge and every answer students have given.',
  chapters: 'Deletes every chapter and subtopic. The subject itself is kept.',
}

export default function ResetPanel({ scope, onDone }: ResetPanelProps) {
  const { can } = useAuth()
  const mayReset = can('content:reset')

  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<ResetPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const loadPreview = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<{ preview: ResetPreview }>(`/admin/reset/${scope}/preview`)
      setPreview(res.preview)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not work out what this would delete.')
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    if (open) void loadPreview()
  }, [open, loadPreview])

  // Escape closes the dialog. Cheap, expected, and the fastest way out of a screen
  // somebody has opened by mistake.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function close() {
    setOpen(false)
    setTyped('')
    setError('')
    setPreview(null)
  }

  async function performReset() {
    if (!preview) return
    setBusy(true)
    setError('')
    try {
      const res = await api.post<{ label: string; deleted: ResetLine[]; totalDeleted: number }>(
        `/admin/reset/${scope}`,
        { confirm: typed.trim() },
      )
      setDone(
        `${res.label} reset. Deleted ${
          res.deleted
            .filter((line) => line.count > 0)
            .map((line) => line.text)
            .join(' and ') || 'nothing — it was already empty'
        }.`,
      )
      close()
      onDone?.()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not complete that reset.')
    } finally {
      setBusy(false)
    }
  }

  if (!mayReset) return null

  const phraseMatches = preview !== null && typed.trim() === preview.confirmPhrase
  const blocked = (preview?.blockers.length ?? 0) > 0

  return (
    <section className={styles.zone} aria-labelledby={`danger-${scope}`}>
      <div className={styles.zoneHead}>
        <h3 id={`danger-${scope}`}>
          <Icon name="ph-warning-octagon" weight="bold" /> Danger zone
        </h3>
        <p>{SCOPE_BLURBS[scope]}</p>
        {done && <p className={styles.done}>{done}</p>}
      </div>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>
        <Icon name="ph-trash" weight="bold" /> {SCOPE_TITLES[scope]}
      </button>

      {open && (
        <div className={styles.backdrop} role="dialog" aria-modal="true" aria-labelledby={`reset-title-${scope}`}>
          <div className={styles.modal}>
            {/* The loudest thing on the screen, and it says what happens rather than
                "are you sure?" — which is the question people answer without reading. */}
            <div className={styles.alarm}>
              <Icon name="ph-warning" weight="bold" />
              <div>
                <strong id={`reset-title-${scope}`}>This permanently deletes data. It cannot be undone.</strong>
                <span>There is no backup, no undo and no recycle bin. Read the list below before you continue.</span>
              </div>
            </div>

            {loading && <Spinner label="Counting what this would delete..." />}
            {error && <p className="error-text">{error}</p>}

            {preview && !loading && (
              <>
                <h4 className={styles.modalTitle}>{SCOPE_TITLES[scope]}</h4>

                {blocked ? (
                  /* No input, no button — only the way forward. A confirmation field here
                     would invite somebody to type the phrase and then meet a 409. */
                  <div className={styles.blocked}>
                    <p className={styles.blockedLead}>
                      <Icon name="ph-prohibit" weight="bold" /> This reset is blocked, because it would leave data
                      pointing at things that no longer exist.
                    </p>
                    <ul>
                      {preview.blockers.map((blocker) => (
                        <li key={blocker.label}>
                          {blocker.label}
                          {blocker.resolveWith && (
                            <span className={styles.blockedHint}>
                              {' '}
                              — reset that area first.
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : preview.totalToDelete === 0 ? (
                  <p className={styles.empty}>
                    There is nothing here to delete — this area is already empty.
                  </p>
                ) : (
                  <>
                    <p className={styles.willDelete}>This will delete:</p>
                    <ul className={styles.deleteList}>
                      {preview.deletes.map((line) => (
                        <li key={line.label}>
                          {/* `text`, not a count joined to a label: the server builds the
                              phrase so it agrees with its own number. */}
                          <strong>{line.text}</strong>
                          {line.note && <span className={styles.note}> — {line.note}</span>}
                        </li>
                      ))}
                    </ul>

                    <p className={styles.willKeep}>This will not touch:</p>
                    <ul className={styles.keepList}>
                      {preview.preserves.map((item) => (
                        <li key={item}>
                          <Icon name="ph-check" weight="bold" /> {item}
                        </li>
                      ))}
                    </ul>

                    <div className={styles.confirmRow}>
                      <label htmlFor={`confirm-${scope}`}>
                        Type <code>{preview.confirmPhrase}</code> to confirm
                      </label>
                      <input
                        id={`confirm-${scope}`}
                        className="form-control"
                        value={typed}
                        onChange={(e) => setTyped(e.target.value)}
                        placeholder={preview.confirmPhrase}
                        autoComplete="off"
                        spellCheck={false}
                        disabled={busy}
                      />
                    </div>
                  </>
                )}

                <div className={styles.actions}>
                  <button type="button" className={styles.cancel} onClick={close} disabled={busy}>
                    Cancel
                  </button>
                  {!blocked && preview.totalToDelete > 0 && (
                    <button
                      type="button"
                      className={styles.destroy}
                      disabled={busy || !phraseMatches}
                      onClick={() => void performReset()}
                    >
                      {busy ? 'Deleting…' : `Delete ${preview.totalToDelete.toLocaleString('en-IN')} records`}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
