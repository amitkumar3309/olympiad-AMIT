import { useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Alert, Button, Field, Icon, Input, PasswordInput, Select, Steps, Textarea } from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import { PASSWORD_RULES, passwordProblem } from '../../lib/passwordPolicy'
import { formatCooldown, useResendCooldown } from '../../lib/resendCooldown'
import { SUPPORT } from '../../lib/brand'
import { CLASS_LEVELS, type ClassLevel, type ReferralCheck } from '../../api/types'
import styles from './RegisterForm.module.css'

/**
 * Registration: thirteen fields, a photograph, and three steps.
 *
 * Extracted from `Landing.tsx` in Milestone 23 Phase C — the landing page is a
 * marketing surface that *contains* this form, not a form with a page around it, and at
 * 749 lines the two were hard to reason about separately.
 *
 * ## What changed, and why it is the whole point of this phase
 *
 * It validated into **one string**: the first problem it found, shown at the top of a
 * form that is two screens long on a phone. So a student with three mistakes was sent
 * round three times, scrolling up each time to read a message that never said which
 * field it meant.
 *
 * Now every problem is found in one pass and reported **on the field it belongs to**,
 * with a summary at the top that names each one and moves focus to it. That is the
 * standard error-summary pattern, and on a long mobile form it is the difference
 * between finishing and giving up.
 *
 * The rules themselves are unchanged, and are still a convenience: the server's zod
 * schema remains the authority, and this form re-derives nothing it does not also send.
 *
 * ## The photograph
 *
 * Checked here for type and size before it is read, because a 6 MB photograph from a
 * phone camera is the ordinary case and finding out after the upload is a wasted
 * minute on a slow connection. `MAX_PHOTO_BYTES` is kept in step with the backend's.
 */

type WizardStep = 'details' | 'confirm' | 'success'

const REGISTER_STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 'details', label: 'Your details' },
  { id: 'confirm', label: 'Check' },
  { id: 'success', label: 'Verify email' },
]

const EMPTY_FORM = {
  firstName: '',
  middleName: '',
  lastName: '',
  fatherName: '',
  motherName: '',
  dateOfBirth: '',
  classLevel: '',
  schoolName: '',
  address: '',
  mobile: '',
  email: '',
  password: '',
  confirmPassword: '',
}

type FormField = keyof typeof EMPTY_FORM
type ErrorKey = FormField | 'photo'
type Errors = Partial<Record<ErrorKey, string>>

interface SelectedPhoto {
  dataUrl: string
  name: string
  size: number
}

/** Kept in step with the backend's `MAX_PHOTO_BYTES`. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

/** Field ids are fixed so the error summary can move focus to one. */
const fieldId = (field: ErrorKey) => `reg-${field}`

/** The label each field is called in the summary, so a message can name it. */
const LABELS: Record<ErrorKey, string> = {
  firstName: 'First name',
  middleName: 'Middle name',
  lastName: 'Last name',
  fatherName: "Father's name",
  motherName: "Mother's name",
  dateOfBirth: 'Date of birth',
  classLevel: 'Class',
  schoolName: 'School name',
  address: 'Full address',
  mobile: 'Mobile number',
  email: 'Email address',
  password: 'Password',
  confirmPassword: 'Confirm password',
  photo: 'Photograph',
}

/** Order matters: the summary lists problems in the order they appear on screen. */
const FIELD_ORDER: ErrorKey[] = [
  'firstName',
  'middleName',
  'lastName',
  'fatherName',
  'motherName',
  'dateOfBirth',
  'classLevel',
  'schoolName',
  'address',
  'photo',
  'mobile',
  'email',
  'password',
  'confirmPassword',
]

const REQUIRED: FormField[] = [
  'firstName',
  'lastName',
  'fatherName',
  'motherName',
  'dateOfBirth',
  'classLevel',
  'schoolName',
  'address',
  'mobile',
  'email',
]

/** Reads a chosen file into the base64 data URL the API expects. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

export interface RegisterFormProps {
  /** The `?ref=` code, already checked against the server by the page. */
  referral: ReferralCheck | null
  /** Opens the sign-in dialog — offered once the account exists. */
  onRequestLogin: () => void
}

export default function RegisterForm({ referral, onRequestLogin }: RegisterFormProps) {
  const { register, resendVerification } = useAuth()

  const [step, setStep] = useState<WizardStep>('details')
  const [form, setForm] = useState(EMPTY_FORM)
  const [photo, setPhoto] = useState<SelectedPhoto | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [registeredId, setRegisteredId] = useState('')

  /**
   * The wait before another verification link may be requested (owner's request,
   * 2026-09-02). Started from the registration response, so the first thing a new
   * student sees is how long the link they have just been sent is worth waiting for
   * — rather than a resend button inviting them to replace it immediately.
   */
  const cooldown = useResendCooldown(form.email)
  /**
   * The outcome of a resend, and **whether it worked**.
   *
   * These were one string rendered in an `info` Alert, so a resend that failed — a rate
   * limit, a dropped connection — was announced in the same calm blue box as one that
   * succeeded, reading as though a link were on its way when none was. A student who
   * then waits for an email that does not exist has been actively misled by the screen
   * that was supposed to help. Tone has to follow the outcome.
   */
  const [resendResult, setResendResult] = useState<{ ok: boolean; message: string } | null>(null)
  /** Drives the button's own loading state, so the press is acknowledged immediately. */
  const [resending, setResending] = useState(false)

  const setField =
    (field: FormField) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const { value } = event.target
      setForm((current) => ({ ...current, [field]: value }))
      // Clearing as they type: leaving a message under a field somebody is currently
      // fixing is what makes a form feel like it is arguing with you.
      if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
    }

  function validate(): Errors {
    const next: Errors = {}

    for (const field of REQUIRED) {
      if (!form[field].trim()) next[field] = `${LABELS[field]} is required.`
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = 'Enter an email address we can reach, like you@example.com.'
    }
    if (form.mobile.trim() && !/^\d{10}$/.test(form.mobile.replace(/\s/g, ''))) {
      next.mobile = 'Enter the 10-digit mobile number, without the country code.'
    }
    if (!photo) next.photo = 'A passport-style photograph is required.'
    // One definition of the policy, mirrored from the server (`lib/passwordPolicy.ts`),
    // and it names **every** missing requirement at once rather than the next one.
    const passwordIssue = passwordProblem(form.password)
    if (passwordIssue) {
      next.password = passwordIssue
    }
    if (form.confirmPassword !== form.password) {
      next.confirmPassword = 'The two passwords do not match.'
    }

    return next
  }

  function focusField(key: ErrorKey) {
    const el = document.getElementById(fieldId(key))
    // `block: 'center'` because a field at the top of the viewport sits under the
    // sticky header; instant because a smooth scroll silently does nothing in
    // environments that do not animate (the Phase F lesson, kept).
    el?.scrollIntoView({ behavior: 'auto', block: 'center' })
    el?.focus({ preventScroll: true })
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    setErrors((current) => ({ ...current, photo: undefined }))
    const file = event.target.files?.[0]
    if (!file) {
      setPhoto(null)
      return
    }
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setPhoto(null)
      setErrors((current) => ({ ...current, photo: 'The photograph must be a JPEG, PNG or WebP image.' }))
      event.target.value = ''
      return
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhoto(null)
      setErrors((current) => ({
        ...current,
        photo: `That photograph is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Please choose one of 2 MB or less.`,
      }))
      event.target.value = ''
      return
    }
    try {
      setPhoto({ dataUrl: await readAsDataUrl(file), name: file.name, size: file.size })
    } catch {
      setPhoto(null)
      setErrors((current) => ({ ...current, photo: 'Could not read that file. Please choose it again.' }))
    }
  }

  function handleDetailsSubmit(event: FormEvent) {
    event.preventDefault()
    setFailure('')
    const found = validate()
    setErrors(found)

    const first = FIELD_ORDER.find((key) => found[key])
    if (first) {
      focusField(first)
      return
    }
    setStep('confirm')
  }

  async function handleCreateAccount() {
    if (!photo) {
      setErrors((current) => ({ ...current, photo: 'A passport-style photograph is required.' }))
      setStep('details')
      return
    }
    setSubmitting(true)
    setFailure('')
    try {
      const result = await register({
        firstName: form.firstName.trim(),
        middleName: form.middleName.trim(),
        lastName: form.lastName.trim(),
        fatherName: form.fatherName.trim(),
        motherName: form.motherName.trim(),
        dateOfBirth: form.dateOfBirth,
        classLevel: form.classLevel as ClassLevel,
        schoolName: form.schoolName.trim(),
        address: form.address.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim(),
        password: form.password,
        photo: photo.dataUrl,
        /**
         * Only a code the server has confirmed. An unchecked one would risk the whole
         * registration — the backend refuses on a code that does not resolve — and the
         * banner above the form has already told the student when one is being dropped.
         */
        ...(referral?.valid ? { referralCode: referral.code } : {}),
      })
      setRegisteredId(result.student.studentId)
      cooldown.start(result.nextResendAt, form.email.trim())
      setStep('success')
    } catch (err) {
      setFailure(humanizeError(err, { fallback: 'Registration failed. Please try again.' }))
      setStep('details')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleResend() {
    setResendResult(null)
    setResending(true)
    try {
      const result = await resendVerification(form.email.trim())
      setResendResult({ ok: true, message: result.message })
      cooldown.start(result.nextResendAt, form.email.trim())
    } catch (err) {
      setResendResult({
        ok: false,
        message: humanizeError(err, { fallback: 'Could not send a new link. Please try again.' }),
      })
    } finally {
      setResending(false)
    }
  }

  const problems = FIELD_ORDER.filter((key) => errors[key])

  return (
    <div className={styles.card}>
      <Steps steps={REGISTER_STEPS} current={step} label="Registration steps" />

      {/*
        Who invited them, or that the code will not be used. Shown before the first
        field rather than beside a hidden input, because it changes what the student
        expects to happen — and because a dropped code has to be visible, not silent.
      */}
      {referral?.valid && (
        <Alert tone="success" icon="ph-user-check" className={styles.banner}>
          Invited by <strong>{referral.referrerName}</strong>. Their code <code>{referral.code}</code> will be
          applied to your registration.
        </Alert>
      )}
      {referral && !referral.valid && (
        <Alert tone="warning" className={styles.banner}>
          The referral code <code>{referral.code}</code> is not valid, so it will not be applied. You can still
          register normally — check the link with whoever shared it.
        </Alert>
      )}

      {failure && (
        <Alert tone="danger" title="We could not create your account" className={styles.banner}>
          {failure}
        </Alert>
      )}

      {step === 'details' && (
        <form onSubmit={handleDetailsSubmit} noValidate>
          <h2 className={styles.heading}>Create your account</h2>
          <p className={styles.lead}>
            It takes a couple of minutes, and it is free — the entry fee is paid later, only if you enter the
            Olympiad itself.
          </p>

          {/*
            The error summary. Assertive, because it appears in response to a press and
            the reader is waiting for it; each entry moves focus to its field, which is
            what makes it useful on a form this long rather than merely informative.
          */}
          {problems.length > 0 && (
            <Alert
              tone="danger"
              title={problems.length === 1 ? 'One field needs your attention' : `${problems.length} fields need your attention`}
              className={styles.banner}
            >
              <ul className={styles.problemList}>
                {problems.map((key) => (
                  <li key={key}>
                    <button type="button" className={styles.problemLink} onClick={() => focusField(key)}>
                      {LABELS[key]}: {errors[key]}
                    </button>
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <Section title="Student details">
            <div className={styles.grid}>
              <Field id={fieldId('firstName')} label="First name" required error={errors.firstName}>
                <Input autoComplete="given-name" value={form.firstName} onChange={setField('firstName')} />
              </Field>
              <Field id={fieldId('middleName')} label="Middle name" optional>
                <Input
                  autoComplete="additional-name"
                  value={form.middleName}
                  onChange={setField('middleName')}
                />
              </Field>
              <Field id={fieldId('lastName')} label="Last name" required error={errors.lastName}>
                <Input autoComplete="family-name" value={form.lastName} onChange={setField('lastName')} />
              </Field>
              <Field id={fieldId('dateOfBirth')} label="Date of birth" required error={errors.dateOfBirth}>
                <Input
                  type="date"
                  autoComplete="bday"
                  max={new Date().toISOString().slice(0, 10)}
                  value={form.dateOfBirth}
                  onChange={setField('dateOfBirth')}
                />
              </Field>
              <Field id={fieldId('fatherName')} label="Father's name" required error={errors.fatherName}>
                <Input value={form.fatherName} onChange={setField('fatherName')} />
              </Field>
              <Field id={fieldId('motherName')} label="Mother's name" required error={errors.motherName}>
                <Input value={form.motherName} onChange={setField('motherName')} />
              </Field>
              <Field id={fieldId('classLevel')} label="Class" required error={errors.classLevel}>
                <Select value={form.classLevel} onChange={setField('classLevel')}>
                  <option value="">Select your class</option>
                  {CLASS_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={fieldId('schoolName')} label="Current school" required error={errors.schoolName}>
                <Input autoComplete="off" value={form.schoolName} onChange={setField('schoolName')} />
              </Field>
            </div>

            <Field
              id={fieldId('address')}
              label="Full address"
              required
              hint="House or street, city, state and PIN code."
              error={errors.address}
            >
              <Textarea rows={3} autoComplete="street-address" value={form.address} onChange={setField('address')} />
            </Field>
          </Section>

          <Section title="Photograph">
            <Field
              id={fieldId('photo')}
              label="Passport-style photograph"
              required
              hint="JPEG, PNG or WebP, up to 2 MB. This appears on your certificate."
              error={errors.photo}
            >
              {/*
                A raw `<input type="file">` rather than a control from the design
                system: the native picker is the whole feature on a phone — it offers
                the camera — and nothing we could build would improve on it. It carries
                its own ARIA wiring because it does not read the field context, and
                `aria-describedby` names the error id **only when there is one**, or it
                would point at an element that is not in the document.
              */}
              <input
                id={fieldId('photo')}
                type="file"
                className={styles.file}
                accept={ACCEPTED_PHOTO_TYPES.join(',')}
                aria-describedby={errors.photo ? 'reg-photo-hint reg-photo-error' : 'reg-photo-hint'}
                aria-invalid={errors.photo ? true : undefined}
                onChange={handlePhotoChange}
              />
            </Field>
            {photo && (
              <div className={styles.photoPreview}>
                <img src={photo.dataUrl} alt="The photograph you chose" />
                <div className={styles.photoMeta}>
                  <span className={styles.photoName}>{photo.name}</span>
                  <span className={styles.photoSize}>{(photo.size / 1024).toFixed(0)} KB</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  icon="ph-x"
                  onClick={() => {
                    setPhoto(null)
                    const input = document.getElementById(fieldId('photo')) as HTMLInputElement | null
                    if (input) input.value = ''
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
          </Section>

          <Section title="Contact and sign-in">
            <div className={styles.grid}>
              <Field
                id={fieldId('mobile')}
                label="Mobile number"
                required
                hint="Used for WhatsApp updates. 10 digits, no country code."
                error={errors.mobile}
              >
                <Input
                  type="tel"
                  // `inputMode` rather than `type="number"`: a number input drops
                  // leading zeros and shows a spinner nobody wants on a phone number.
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  value={form.mobile}
                  onChange={setField('mobile')}
                />
              </Field>
              <Field
                id={fieldId('email')}
                label="Email address"
                required
                hint="We send the verification link here — you need it to sign in."
                error={errors.email}
              >
                <Input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={setField('email')}
                />
              </Field>
              <Field
                id={fieldId('password')}
                label="Password"
                required
                error={errors.password}
              >
                <PasswordInput
                  autoComplete="new-password"
                  value={form.password}
                  onChange={setField('password')}
                />
                {/*
                  The requirements, ticked off as they are met.

                  Shown always rather than only after a failed submit: a reader should
                  know what is being asked of them *before* choosing a password, and the
                  alternative — revealing the next missing rule after each attempt — is
                  what makes people try five passwords in a row.

                  `aria-live="polite"` so a screen-reader user hears a rule being
                  satisfied without having to re-read the list; the icon is never the only
                  carrier of meaning, since each rule keeps its words either way.
                */}
                <ul className={styles.passwordRules} aria-live="polite">
                  {PASSWORD_RULES.map((rule) => {
                    const met = rule.met(form.password)
                    return (
                      <li key={rule.id} className={met ? styles.ruleMet : styles.ruleUnmet}>
                        <Icon
                          name={met ? 'ph-check-circle' : 'ph-circle'}
                          weight="bold"
                          size="sm"
                          label={met ? 'Met:' : 'Still needed:'}
                        />
                        <span>{rule.label}</span>
                      </li>
                    )
                  })}
                </ul>
              </Field>
              <Field
                id={fieldId('confirmPassword')}
                label="Confirm password"
                required
                error={errors.confirmPassword}
              >
                <PasswordInput
                  autoComplete="new-password"
                  describedAs="confirmed password"
                  value={form.confirmPassword}
                  onChange={setField('confirmPassword')}
                />
              </Field>
            </div>
          </Section>

          <Button type="submit" size="lg" fullWidth iconAfter="ph-arrow-right">
            Review and continue
          </Button>
        </form>
      )}

      {/*
        The entry fee is NOT collected here, and the QR code that used to sit on this
        step is gone (Milestone 19).

        It could not be made real: at this point there is no account and no session,
        and a Razorpay order has to be recorded against a student — that is what makes
        the entitlement work and what stops one person's payment entitling another.
        Registration also deliberately issues no session until the email is verified.

        What was here before was worse than nothing: a static QR and an "I've Paid"
        button that recorded no payment, verified nothing, and created the account
        regardless. It told every student something untrue.
      */}
      {step === 'confirm' && (
        <div className={styles.confirm}>
          <h2 className={styles.heading}>One last check</h2>

          <dl className={styles.summary}>
            <Summary label="Name">
              {[form.firstName, form.middleName, form.lastName].filter(Boolean).join(' ')}
            </Summary>
            <Summary label="Class">{form.classLevel}</Summary>
            <Summary label="School">{form.schoolName}</Summary>
            <Summary label="Email">{form.email}</Summary>
            <Summary label="Mobile">{form.mobile}</Summary>
          </dl>

          <Alert tone="info" title="Creating your account is free">
            <p>
              Practice, mock tests, the daily challenge and your performance analytics are all included at no
              cost.
            </p>
            <p>
              The <strong>Olympiad entry fee</strong> is paid separately, from your dashboard, once your account is
              active — by UPI, card, net banking or wallet.
            </p>
          </Alert>

          <div className={styles.confirmActions}>
            <Button variant="secondary" icon="ph-arrow-left" onClick={() => setStep('details')}>
              Back to the form
            </Button>
            <Button size="lg" loading={submitting} icon="ph-check" onClick={() => void handleCreateAccount()}>
              {submitting ? 'Creating your account' : 'Create my account'}
            </Button>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className={styles.success}>
          <span className={styles.successIcon}>
            <Icon name="ph-envelope-simple" weight="bold" size="lg" />
          </span>
          <h2 className={styles.heading}>Check your email, {form.firstName}</h2>
          <p className={styles.lead}>
            Your account is created — your student ID is{' '}
            <strong className={styles.studentId}>{registeredId}</strong>. One step left: we have sent a
            verification link to <strong className={styles.sentTo}>{form.email}</strong>. Open it to activate
            your account, then sign in.
          </p>

          {/*
            The three things a reader needs before they start worrying, stated once and
            up front rather than discovered one at a time. The link's lifetime matches
            `config.auth.emailVerifyTtlHours`; the spam note is here because a new
            sender's first message to an address is the one most likely to be filtered,
            and "it never arrived" is overwhelmingly "it arrived somewhere else".
          */}
          <ul className={styles.successNotes}>
            {/*
              Each line is exactly two grid children — the icon, and one span holding all
              the text. Without the span, an inline <strong> becomes a grid item of its
              own and is placed in the *icon* column on the next row, which is what "The
              link works for / 24 hours and can be used once." looked like in the browser.
            */}
            <li>
              <Icon name="ph-clock" />
              <span>
                The link works for <strong>24 hours</strong> and can be used once.
              </span>
            </li>
            <li>
              <Icon name="ph-folder-simple" />
              <span>Not there after a minute or two? Check your spam or promotions folder.</span>
            </li>
            <li>
              <Icon name="ph-shield-check" />
              <span>
                You cannot sign in until the address is verified — that is what stops somebody
                registering with an address that is not theirs.
              </span>
            </li>
          </ul>

          {resendResult && (
            <Alert tone={resendResult.ok ? 'success' : 'danger'}>{resendResult.message}</Alert>
          )}

          <div className={styles.successActions}>
            <Button icon="ph-sign-in" onClick={onRequestLogin}>
              I have verified — sign me in
            </Button>
            <Button
              variant="secondary"
              icon="ph-paper-plane-tilt"
              loading={resending}
              onClick={() => void handleResend()}
              disabled={cooldown.secondsLeft > 0}
            >
              {cooldown.secondsLeft > 0
                ? `Resend in ${formatCooldown(cooldown.secondsLeft)}`
                : 'Resend the link'}
            </Button>
          </div>

          {/* Why the button is unavailable, in the page rather than a tooltip: a
              disabled control with no stated reason reads as a fault, and a `title`
              never appears on a touch screen. */}
          {cooldown.secondsLeft > 0 && (
            <p className={styles.resendHint}>
              The link is on its way. You can ask for another in{' '}
              <strong>{formatCooldown(cooldown.secondsLeft)}</strong> — a new link replaces the one already
              sent, so check your inbox (and your spam folder) first.
            </p>
          )}

          {/*
            The dead end this screen would otherwise have.

            A mistyped address cannot be corrected by the student: changing an account's
            email is deliberately not built (`validation/profileSchemas.ts` — without a
            confirm-at-the-new-address step it is an account-takeover primitive), and
            registering again is refused, because the mobile number is already taken. So
            the only real route is a human, and saying so is better than leaving somebody
            to discover both refusals for themselves.
          */}
          <p className={styles.resendHint}>
            Typed the wrong address? It cannot be changed from here, so email{' '}
            <a href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a> with your student ID and we will sort it
            out.
          </p>
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  )
}

function Summary({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.summaryRow}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
