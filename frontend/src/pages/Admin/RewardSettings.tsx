import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../../api/client'
import { ACTIVITY_LABELS, type ActivityType, type RewardConfigResponse, type RewardTableRow } from '../../api/types'
import AdminShell from './AdminShell'
import Spinner from '../../components/Spinner'
import Button from '../../components/Button'
import { Alert, Icon, Table, TableScroll } from '../../components/ui'
import styles from './RewardSettings.module.css'

/**
 * The XP award table (Milestone 9).
 *
 * ## What this page can and cannot do
 *
 * It tunes **amounts**. It cannot change which events exist, how often each may be
 * earned, what makes one eligible, or where the level boundaries fall — those are rules,
 * they live in code, and they are reviewed in a diff rather than edited on a Tuesday.
 *
 * And it **cannot re-price anybody's history**. Every activity row stores what its event
 * was worth at the moment it happened, and a student's total is the sum of those
 * recorded values, so a change here affects the next event and nothing else. That is
 * stated on the page, because an administrator who believes otherwise will be afraid to
 * touch it — or, worse, will use it expecting a retroactive effect.
 */

export default function RewardSettings() {
  const [rows, setRows] = useState<RewardTableRow[]>([])
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [meta, setMeta] = useState<{ updatedByLabel: string | null; updatedAt: string | null }>({
    updatedByLabel: null,
    updatedAt: null,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.get<RewardConfigResponse>('/admin/reward-settings')
      setRows(res.config.table)
      setMeta({ updatedByLabel: res.config.updatedByLabel, updatedAt: res.config.updatedAt })
      // The editable draft holds only the overrides; an empty box means "use the
      // default", which is exactly how the API reads an absent key.
      setDraft(
        Object.fromEntries(
          res.config.table.map((row) => [row.event, row.overrideXp === null ? '' : String(row.overrideXp)]),
        ),
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the reward settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      // Only the boxes with a value become overrides. Clearing one is how an event goes
      // back to its code default — there is no separate "reset" action to forget about.
      const xpOverrides: Record<string, number> = {}
      for (const [event, value] of Object.entries(draft)) {
        if (value.trim() === '') continue
        xpOverrides[event] = Number(value)
      }

      const res = await api.put<RewardConfigResponse>('/admin/reward-settings', { xpOverrides })
      setRows(res.config.table)
      setMeta({ updatedByLabel: res.config.updatedByLabel, updatedAt: res.config.updatedAt })
      setNotice('Saved. This applies to events from now on — nothing already earned has changed.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the reward settings.')
    } finally {
      setSaving(false)
    }
  }

  const changed = rows.some((row) => {
    const value = draft[row.event] ?? ''
    const current = row.overrideXp === null ? '' : String(row.overrideXp)
    return value !== current
  })

  return (
    <AdminShell title="Reward Settings">
      <p className={styles.intro}>
        What each recorded event is worth. Leave a box empty to use the value the platform ships with.
      </p>

      <div className={styles.warn}>
        <Icon name="ph-info" weight="bold" />
        <div>
          <strong>Changing these cannot alter anybody&rsquo;s existing XP.</strong> Every event a student has already
          earned stored its own value at the time, and their total is the sum of those — so a change here decides what
          the <em>next</em> event pays and nothing else. There is no way to retroactively re-price history from this
          page, by design.
        </div>
      </div>

      {notice && <p className={styles.notice}>{notice}</p>}
      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <div className={styles.centered}>
          <Spinner />
        </div>
      ) : (
        <div className="card">
          <TableScroll label="XP awards">
            <Table density="compact">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Ships with</th>
                  <th>Override</th>
                  <th>Pays now</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const value = draft[row.event] ?? ''
                  const effective = value.trim() === '' ? row.defaultXp : Number(value)
                  return (
                    <tr key={row.event}>
                      <td>
                        <span className={styles.eventName}>
                          {ACTIVITY_LABELS[row.event as ActivityType]?.label ?? row.event}
                        </span>
                        <span className={styles.eventCode}>{row.event}</span>
                      </td>
                      <td className={styles.mono}>{row.defaultXp}</td>
                      <td>
                        <input
                          className="form-control"
                          type="number"
                          min={0}
                          max={500}
                          step={1}
                          placeholder="default"
                          value={value}
                          aria-label={`XP override for ${row.event}`}
                          onChange={(e) => setDraft((current) => ({ ...current, [row.event]: e.target.value }))}
                        />
                      </td>
                      <td className={`${styles.mono} ${effective !== row.defaultXp ? styles.overridden : ''}`}>
                        {Number.isFinite(effective) ? effective : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          </TableScroll>

          <div className={styles.actions}>
            <Button onClick={() => void save()} disabled={saving || !changed}>
              {saving ? 'Saving…' : 'Save award table'}
            </Button>
            <Button variant="outline" onClick={() => void load()} disabled={saving || !changed}>
              Discard changes
            </Button>
            {meta.updatedAt && (
              <span className={styles.meta}>
                Last changed {new Date(meta.updatedAt).toLocaleString()}
                {meta.updatedByLabel ? ` by ${meta.updatedByLabel}` : ''}
              </span>
            )}
          </div>

          <p className={styles.help}>
            An event worth <strong>0</strong> is still recorded and still appears on a student&rsquo;s activity feed —
            it simply earns nothing. That is how profile edits work by default, because they are repeatable at will and
            paying for them would make XP a measure of how often somebody pressed Save.
          </p>
        </div>
      )}
    </AdminShell>
  )
}
