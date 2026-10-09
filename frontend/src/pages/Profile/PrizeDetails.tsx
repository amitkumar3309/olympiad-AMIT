import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import { ELIGIBILITY_LABELS, type OwnProfile, type ProfileUpdateInput } from '../../api/types'
import { Alert, Badge, Button, Card, CardHeader, Checkbox, Field, Input } from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import { formatDate } from '../../lib/format'
import styles from './Profile.module.css'

/**
 * Prize details (Milestone 30, Phase 2 — brief §6.6).
 *
 * A Daily Quiz winner is a child, and the prize reaches them through a parent or guardian,
 * so a winner needs a city and a parent or guardian's phone number on file. Playing never
 * needs either — only winning does — and this card says exactly what is missing, using the
 * server's own eligibility check rather than re-deciding it here.
 *
 * Saved through the same `PATCH /me/profile` as the rest of the profile: the request carries
 * the student's current details unchanged, plus these fields.
 *
 * **A parent or guardian's agreement** (Milestone 30, Phase 6 — brief §10) is asked for at
 * registration now; an account made before that gives it here, in the same words. Once given
 * it is a date, not a box — the server records it once, and withdrawing it is a question for
 * the legal review rather than an untick.
 */

interface UpdateResponse {
  changed: boolean
  profile: OwnProfile
}

export default function PrizeDetails({ profile, onSaved }: { profile: OwnProfile; onSaved: (profile: OwnProfile) => void }) {
  const [city, setCity] = useState(profile.city ?? '')
  const [guardianPhone, setGuardianPhone] = useState(profile.guardianPhone ?? '')
  const [guardianEmail, setGuardianEmail] = useState(profile.guardianEmail ?? '')
  const [hide, setHide] = useState(profile.hideFromPublicLists)
  const [consent, setConsent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)

  const { eligible, missing } = profile.prizeEligibility

  async function save(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(null)
    if (!profile.classLevel || !profile.firstName || !profile.lastName || !profile.fatherName || !profile.motherName || !profile.dateOfBirth || !profile.schoolName || !profile.address) {
      setError('Complete your student details above first — the profile is saved as a whole.')
      return
    }
    setSaving(true)
    try {
      const payload: ProfileUpdateInput = {
        firstName: profile.firstName,
        middleName: profile.middleName,
        lastName: profile.lastName,
        fatherName: profile.fatherName,
        motherName: profile.motherName,
        dateOfBirth: profile.dateOfBirth,
        classLevel: profile.classLevel,
        schoolName: profile.schoolName,
        address: profile.address,
        city: city.trim() === '' ? null : city.trim(),
        guardianPhone: guardianPhone.trim() === '' ? null : guardianPhone.trim(),
        guardianEmail: guardianEmail.trim() === '' ? null : guardianEmail.trim(),
        hideFromPublicLists: hide,
        ...(consent && !profile.guardianConsentAt ? { guardianConsent: true as const } : {}),
      }
      const res = await api.patch<UpdateResponse>('/me/profile', payload)
      onSaved(res.profile)
      setSaved(res.changed ? 'Saved.' : 'No changes to save.')
    } catch (err) {
      setError(humanizeError(err, { fallback: 'Your prize details could not be saved.' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card as="section" id="prize-details" aria-labelledby="prize-details-title" className={styles.prizeCard}>
      <CardHeader
        title={<span id="prize-details-title">Prize details</span>}
        as="h2"
        size="sm"
        description="Each month’s Daily Quiz winners get a surprise gift and a cash prize, delivered through a parent or guardian."
        actions={
          eligible ? (
            <Badge tone="success" icon="ph-seal-check">
              Eligible for prizes
            </Badge>
          ) : (
            <Badge tone="warning" icon="ph-warning">
              Not yet eligible
            </Badge>
          )
        }
      />
      {!eligible && (
        <Alert tone="info" title="Complete your profile to be eligible for prizes">
          Still needed: {missing.map((key) => ELIGIBILITY_LABELS[key]).join(', ')}. You can play the Daily Quiz either way.
        </Alert>
      )}
      <form onSubmit={(event) => void save(event)} className={styles.prizeForm}>
        <div className={styles.row}>
          <Field label="City" hint="Where a prize would be delivered.">
            <Input value={city} onChange={(event) => setCity(event.target.value)} maxLength={80} autoComplete="address-level2" />
          </Field>
          <Field label="Parent or guardian’s phone" hint="The organisers call this number before announcing a winner.">
            <Input
              value={guardianPhone}
              onChange={(event) => setGuardianPhone(event.target.value)}
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
            />
          </Field>
        </div>
        <Field label="Parent or guardian’s email" optional>
          <Input type="email" value={guardianEmail} onChange={(event) => setGuardianEmail(event.target.value)} maxLength={200} autoComplete="email" />
        </Field>
        {profile.guardianConsentAt ? (
          <p className={styles.consentGiven}>
            A parent or guardian agreed on {formatDate(profile.guardianConsentAt)}.
          </p>
        ) : (
          <Checkbox
            label={
              <>
                I am the parent/guardian, or I have my parent/guardian&rsquo;s permission, and I agree to the{' '}
                <a href="/terms" target="_blank" rel="noopener noreferrer">
                  Terms
                </a>{' '}
                and{' '}
                <a href="/privacy" target="_blank" rel="noopener noreferrer">
                  Privacy Policy
                </a>
              </>
            }
            description="Needed before a prize can be awarded. Saved with your prize details."
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
        )}
        <Checkbox
          label="Keep my name off public lists"
          description={`If you win, the site shows “A ${profile.classLevel ?? 'Class'} student” instead of your first name, last initial and city.`}
          checked={hide}
          onChange={(event) => setHide(event.target.checked)}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {saved && <Alert tone="success">{saved}</Alert>}
        <div>
          <Button type="submit" loading={saving} icon="ph-floppy-disk">
            Save prize details
          </Button>
        </div>
      </form>
    </Card>
  )
}
