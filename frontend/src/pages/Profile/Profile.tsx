import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import StudentShell from '../../components/StudentShell'
import { Alert, Button, ErrorState, Icon, SkeletonCards, Spinner } from '../../components/ui'
import { api, ApiError } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import {
  CLASS_LEVELS,
  type ClassLevel,
  type NotificationPrefs,
  type NotificationPrefsResponse,
  type OwnProfile,
  type ProfileUpdateInput,
} from '../../api/types'
import { PHOTO_ACCEPT_ATTRIBUTE, formatBytes, readPhotoFile, type SelectedPhoto } from '../../lib/photo'
import EntryFeeCard from '../../components/EntryFeeCard'
import styles from './Profile.module.css'

/**
 * The student's own profile and account settings.
 *
 * This page closes the gap recorded in PROJECT_STATE.md as "no one can edit their own
 * details after registering, and there is no way to replace a photo" — until now both
 * needed a direct database edit.
 *
 * Everything shown is loaded from `GET /me/profile`; nothing is seeded from a
 * constant. `email` and `mobile` are displayed but not editable, because they are the
 * login identifiers and changing one needs a confirm-at-the-new-address flow that
 * does not exist yet — the page says so rather than offering a field that would
 * silently fail.
 */

interface ProfileResponse {
  profile: OwnProfile
}

interface UpdateResponse {
  changed: boolean
  profile: OwnProfile
}

type FormState = {
  firstName: string
  middleName: string
  lastName: string
  fatherName: string
  motherName: string
  dateOfBirth: string
  classLevel: string
  schoolName: string
  address: string
}

const EMPTY_FORM: FormState = {
  firstName: '',
  middleName: '',
  lastName: '',
  fatherName: '',
  motherName: '',
  dateOfBirth: '',
  classLevel: '',
  schoolName: '',
  address: '',
}

/** The form fields a student must supply, with the label to name in an error. */
const REQUIRED_FIELDS: Array<[keyof FormState, string]> = [
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['fatherName', "Father's name"],
  ['motherName', "Mother's name"],
  ['dateOfBirth', 'Date of birth'],
  ['classLevel', 'Class'],
  ['schoolName', 'Current school name'],
  ['address', 'Full address'],
]

function formFrom(profile: OwnProfile): FormState {
  return {
    firstName: profile.firstName ?? '',
    middleName: profile.middleName ?? '',
    lastName: profile.lastName ?? '',
    fatherName: profile.fatherName ?? '',
    motherName: profile.motherName ?? '',
    dateOfBirth: profile.dateOfBirth ?? '',
    classLevel: profile.classLevel ?? '',
    schoolName: profile.schoolName ?? '',
    address: profile.address ?? '',
  }
}

function Required() {
  return (
    <span className={styles.required} aria-hidden="true">
      *
    </span>
  )
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function Profile() {
  const { state, logoutEverywhere } = useAuth()

  const [profile, setProfile] = useState<OwnProfile | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  // A cache-busting suffix so the <img> refetches after a replacement — the photo
  // endpoint sends `Cache-Control: private, max-age=300`, so the browser would
  // otherwise keep showing the old picture for five minutes.
  const [photoVersion, setPhotoVersion] = useState(0)
  const [selectedPhoto, setSelectedPhoto] = useState<SelectedPhoto | null>(null)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [photoSaving, setPhotoSaving] = useState(false)

  const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [passwordSaving, setPasswordSaving] = useState(false)

  const [prefs, setPrefs] = useState<NotificationPrefsResponse | null>(null)
  const [prefsError, setPrefsError] = useState('')
  const [prefsSaving, setPrefsSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const res = await api.get<ProfileResponse>('/me/profile')
      setProfile(res.profile)
      setForm(formFrom(res.profile))
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load your profile.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * Loaded separately from the profile, and deliberately not blocking it: a failure
   * here should cost the student their preference switches, not their whole profile
   * page.
   */
  useEffect(() => {
    void api
      .get<NotificationPrefsResponse>('/me/notification-preferences')
      .then(setPrefs)
      .catch((err) =>
        setPrefsError(err instanceof ApiError ? err.message : 'Could not load your notification preferences.'),
      )
  }, [])

  /**
   * Saves one switch immediately, with no separate Save button.
   *
   * A toggle that needs confirming is a toggle people leave in the wrong state. The
   * server accepts a partial update, so one changed switch sends one field — and the
   * response is the authority for what is now stored, rather than the optimistic value
   * this component guessed.
   */
  async function savePrefs(change: Partial<NotificationPrefs>) {
    setPrefsSaving(true)
    setPrefsError('')
    try {
      const res = await api.patch<{ preferences: NotificationPrefs }>('/me/notification-preferences', change)
      setPrefs((current) => (current === null ? current : { ...current, preferences: res.preferences }))
    } catch (err) {
      setPrefsError(err instanceof ApiError ? err.message : 'Could not save that preference.')
    } finally {
      setPrefsSaving(false)
    }
  }

  function update(field: keyof FormState) {
    return (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }))
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    setSavedMessage(null)

    const missing = REQUIRED_FIELDS.find(([field]) => !form[field].trim())
    if (missing) {
      setFormError(`${missing[1]} is required.`)
      return
    }

    setSaving(true)
    try {
      const payload: ProfileUpdateInput = {
        firstName: form.firstName.trim(),
        // An empty box means "no middle name", which the API takes as null.
        middleName: form.middleName.trim() === '' ? null : form.middleName.trim(),
        lastName: form.lastName.trim(),
        fatherName: form.fatherName.trim(),
        motherName: form.motherName.trim(),
        dateOfBirth: form.dateOfBirth,
        classLevel: form.classLevel as ClassLevel,
        schoolName: form.schoolName.trim(),
        address: form.address.trim(),
      }

      const res = await api.patch<UpdateResponse>('/me/profile', payload)
      setProfile(res.profile)
      setForm(formFrom(res.profile))
      setEditing(false)
      setSavedMessage(res.changed ? 'Your details have been saved.' : 'No changes to save.')
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save your details.')
    } finally {
      setSaving(false)
    }
  }

  async function handlePhotoChoice(e: ChangeEvent<HTMLInputElement>) {
    setPhotoError(null)
    const file = e.target.files?.[0]
    if (!file) return

    const result = await readPhotoFile(file)
    if ('error' in result) {
      setSelectedPhoto(null)
      setPhotoError(result.error)
      return
    }
    setSelectedPhoto(result.photo)
  }

  async function handlePhotoUpload() {
    if (!selectedPhoto) return
    setPhotoError(null)
    setPhotoSaving(true)
    try {
      await api.put('/me/photo', { photo: selectedPhoto.dataUrl })
      setSelectedPhoto(null)
      setPhotoVersion((v) => v + 1)
      setProfile((p) => (p ? { ...p, hasPhoto: true } : p))
      setSavedMessage('Your photo has been updated.')
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : 'Could not save your photo.')
    } finally {
      setPhotoSaving(false)
    }
  }

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault()
    setPasswordError(null)
    setPasswordMessage(null)

    if (passwords.newPassword !== passwords.confirmPassword) {
      setPasswordError('The two new passwords do not match.')
      return
    }

    setPasswordSaving(true)
    try {
      const res = await api.post<{ message: string }>('/me/change-password', {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
      })
      setPasswords({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setPasswordMessage(res.message)
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Could not change your password.')
    } finally {
      setPasswordSaving(false)
    }
  }

  if (loading) {
    return (
      <StudentShell title="My profile">
        <SkeletonCards count={3} label="Loading your profile" />
      </StudentShell>
    )
  }

  if (loadError || !profile) {
    return (
      <StudentShell title="My profile">
        <ErrorState
          error={loadError}
          titleAs="h2"
          title="Could not load your profile"
          message={loadError ?? 'Please try again.'}
          onRetry={() => void load()}
        />
      </StudentShell>
    )
  }

  const photoSrc = `/api/v1/students/${profile.studentId}/photo?v=${photoVersion}`

  return (
    <StudentShell
      title="My profile"
      subtitle={
        <>
          Student ID <span className={styles.mono}>{profile.studentId}</span> · Registered{' '}
          {formatDate(profile.registeredAt)}
        </>
      }
    >
      <div className={styles.page}>
        {savedMessage && <p className={styles.successText}>{savedMessage}</p>}

        <div className={styles.layout}>
          {/* ---------------------------------------------------------------
              Photo
          --------------------------------------------------------------- */}
          <section className={`card ${styles.photoCard}`}>
            <h2>Photo</h2>
            {profile.hasPhoto ? (
              <img
                key={photoVersion}
                src={photoSrc}
                alt={`${profile.fullName ?? 'Your'} profile photo`}
                className={styles.photo}
              />
            ) : (
              <div className={styles.photoEmpty}>
                <Icon name="ph-user" weight="bold" size="xl" />
                <p>No photo on file yet.</p>
              </div>
            )}

            <label className={styles.fileLabel}>
              <input type="file" accept={PHOTO_ACCEPT_ATTRIBUTE} onChange={(e) => void handlePhotoChoice(e)} />
              <span>Choose a new photo</span>
            </label>
            <p className={styles.hint}>JPEG, PNG or WebP, up to 2 MB.</p>

            {selectedPhoto && (
              <div className={styles.pendingPhoto}>
                <img src={selectedPhoto.dataUrl} alt="Selected photo preview" className={styles.preview} />
                <div>
                  <p className={styles.fileName}>{selectedPhoto.name}</p>
                  <p className={styles.hint}>{formatBytes(selectedPhoto.size)}</p>
                </div>
                <Button onClick={() => void handlePhotoUpload()} disabled={photoSaving}>
                  {photoSaving ? 'Saving…' : 'Use this photo'}
                </Button>
              </div>
            )}
            {photoError && <Alert tone="danger">{photoError}</Alert>}
          </section>

          {/* ---------------------------------------------------------------
              Details
          --------------------------------------------------------------- */}
          <section className={`card ${styles.detailsCard}`}>
            <div className={styles.sectionHead}>
              <h2>Student details</h2>
              {!editing && (
                <Button size="sm" variant="secondary" icon="ph-pencil-simple" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </div>

            {!editing ? (
              <dl className={styles.readList}>
                <div>
                  <dt>Full name</dt>
                  <dd>{profile.fullName ?? '—'}</dd>
                </div>
                <div>
                  <dt>Father's name</dt>
                  <dd>{profile.fatherName ?? '—'}</dd>
                </div>
                <div>
                  <dt>Mother's name</dt>
                  <dd>{profile.motherName ?? '—'}</dd>
                </div>
                <div>
                  <dt>Date of birth</dt>
                  <dd>{profile.dateOfBirth ?? '—'}</dd>
                </div>
                <div>
                  <dt>Class</dt>
                  <dd>{profile.classLevel ?? '—'}</dd>
                </div>
                <div>
                  <dt>School</dt>
                  <dd>{profile.schoolName ?? '—'}</dd>
                </div>
                <div className={styles.wide}>
                  <dt>Address</dt>
                  <dd>{profile.address ?? '—'}</dd>
                </div>
              </dl>
            ) : (
              <form onSubmit={handleSave} className={styles.form}>
                {formError && <Alert tone="danger">{formError}</Alert>}

                <div className={styles.row}>
                  <label>
                    First name <Required />
                    <input value={form.firstName} onChange={update('firstName')} maxLength={60} />
                  </label>
                  <label>
                    Middle name
                    <input value={form.middleName} onChange={update('middleName')} maxLength={60} />
                  </label>
                  <label>
                    Last name <Required />
                    <input value={form.lastName} onChange={update('lastName')} maxLength={60} />
                  </label>
                </div>

                <div className={styles.row}>
                  <label>
                    Father's name <Required />
                    <input value={form.fatherName} onChange={update('fatherName')} maxLength={60} />
                  </label>
                  <label>
                    Mother's name <Required />
                    <input value={form.motherName} onChange={update('motherName')} maxLength={60} />
                  </label>
                </div>

                <div className={styles.row}>
                  <label>
                    Date of birth <Required />
                    <input type="date" value={form.dateOfBirth} onChange={update('dateOfBirth')} />
                  </label>
                  <label>
                    Class <Required />
                    <select value={form.classLevel} onChange={update('classLevel')}>
                      <option value="">Select a class</option>
                      {CLASS_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label>
                  Current school <Required />
                  <input value={form.schoolName} onChange={update('schoolName')} maxLength={150} />
                </label>

                <label>
                  Full address <Required />
                  <textarea value={form.address} onChange={update('address')} rows={3} maxLength={500} />
                </label>

                <div className={styles.formActions}>
                  <Button type="submit" disabled={saving}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </Button>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={() => {
                      setEditing(false)
                      setForm(formFrom(profile))
                      setFormError(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* ---------------------------------------------------------------
              Olympiad entry

              Here as well as on /payment because "pay later" is the normal path:
              a student prepares for free and decides to compete at some point
              afterwards, and the profile is where they come to manage their
              account. It renders nothing once paid, or when no fee is charged.
          --------------------------------------------------------------- */}
          <EntryFeeCard />

          {/* ---------------------------------------------------------------
              Account settings
          --------------------------------------------------------------- */}
          <section className={`card ${styles.settingsCard}`}>
            <h2>Account settings</h2>

            <dl className={styles.readList}>
              <div>
                <dt>Email</dt>
                <dd>
                  {profile.email}{' '}
                  {profile.isEmailVerified ? (
                    <span className={styles.verified}>
                      <Icon name="ph-seal-check" weight="bold" size="sm" /> Verified
                    </span>
                  ) : (
                    <span className={styles.unverified}>Not verified</span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Mobile</dt>
                <dd className={styles.mono}>{profile.mobile}</dd>
              </div>
              <div>
                <dt>Account status</dt>
                <dd>{profile.status}</dd>
              </div>
              <div>
                <dt>Last sign-in</dt>
                <dd>{formatDate(profile.lastLoginAt)}</dd>
              </div>
            </dl>

            <p className={styles.hint}>
              Your email address and mobile number are how you sign in, so they cannot be changed here yet — contact the
              organisers if one of them is wrong.
            </p>

            <hr className={styles.divider} />

            <h3>Change password</h3>
            <form onSubmit={handlePasswordChange} className={styles.form}>
              {passwordError && <Alert tone="danger">{passwordError}</Alert>}
              {passwordMessage && <p className={styles.successText}>{passwordMessage}</p>}

              <label>
                Current password
                <input
                  type="password"
                  value={passwords.currentPassword}
                  onChange={(e) => setPasswords((p) => ({ ...p, currentPassword: e.target.value }))}
                  autoComplete="current-password"
                />
              </label>
              <div className={styles.row}>
                <label>
                  New password
                  <input
                    type="password"
                    value={passwords.newPassword}
                    onChange={(e) => setPasswords((p) => ({ ...p, newPassword: e.target.value }))}
                    autoComplete="new-password"
                  />
                </label>
                <label>
                  Confirm new password
                  <input
                    type="password"
                    value={passwords.confirmPassword}
                    onChange={(e) => setPasswords((p) => ({ ...p, confirmPassword: e.target.value }))}
                    autoComplete="new-password"
                  />
                </label>
              </div>
              <p className={styles.hint}>
                At least 8 characters, with a letter and a number. Changing it signs you out on every other device.
              </p>
              <div className={styles.formActions}>
                <Button
                  type="submit"
                  disabled={passwordSaving || !passwords.currentPassword || !passwords.newPassword}
                >
                  {passwordSaving ? 'Changing…' : 'Change password'}
                </Button>
              </div>
            </form>

            <hr className={styles.divider} />

            <h3>Sessions</h3>
            <p className={styles.hint}>
              Signs you out of this device and every other one. Use it if you have signed in somewhere you no longer
              trust.
            </p>
            <button type="button" className={styles.secondaryBtn} onClick={() => void logoutEverywhere()}>
              <Icon name="ph-sign-out" weight="bold" /> Sign out everywhere
            </button>

            <hr className={styles.divider} />

            {/* ---------------------------------------------------------------
                Notification preferences (Milestone 14)
            --------------------------------------------------------------- */}
            <h3>Notification preferences</h3>
            <p className={styles.hint}>
              These control <strong>email only</strong>. Everything is always saved to your{' '}
              <Link to="/notifications">notifications page</Link>, so switching an email off never means losing the
              message.
            </p>

            {prefsError && <Alert tone="danger">{prefsError}</Alert>}

            {prefs === null ? (
              <Spinner label="Loading your preferences..." />
            ) : (
              <>
                <label className={styles.prefRow}>
                  <input
                    type="checkbox"
                    checked={prefs.preferences.announcements}
                    disabled={prefsSaving}
                    onChange={(e) => void savePrefs({ announcements: e.target.checked })}
                  />
                  <span>
                    <strong>Announcements</strong>
                    <em>Email me when the organisers post an announcement.</em>
                  </span>
                </label>

                <label className={styles.prefRow}>
                  <input
                    type="checkbox"
                    checked={prefs.preferences.results}
                    disabled={prefsSaving}
                    onChange={(e) => void savePrefs({ results: e.target.checked })}
                  />
                  <span>
                    <strong>Results</strong>
                    <em>Email me when an official exam result is released to me.</em>
                  </span>
                </label>

                {/*
                  Stating what cannot be switched off, rather than quietly offering
                  only two toggles. A settings page that lists two options invites the
                  question "so does it email me about my password or not?" — and the
                  honest answer is worth the space. The reasons come from the server,
                  so the page cannot drift from the policy.
                */}
                <p className={styles.hint}>Always sent, and not optional:</p>
                <ul className={styles.alwaysList}>
                  {prefs.always.map((entry) => (
                    <li key={entry.category}>
                      <strong>{entry.category}</strong> — {entry.reason}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        {state.status === 'student' && state.student.role !== 'student' && (
          <p className={styles.hint}>
            This account also holds the <strong>{state.student.role}</strong> role. Administrative settings live in the{' '}
            <Link to="/admin">admin area</Link>.
          </p>
        )}
      </div>
    </StudentShell>
  )
}
