import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { Alert, Button, Field, Input, Select, Textarea } from '../../components/ui'
import { humanizeError } from '../../lib/errors'
import styles from './Contact.module.css'

/**
 * The Contact page's form (owner, 2026-10-13). It posts to `POST /contact`, which stores the
 * message for Admin → Messages and emails the support address; nothing is sent to the address
 * typed here, so the confirmation is on the page, not in an inbox.
 *
 * The checks mirror `validation/contactSchemas.ts` so a reader sees every problem at once,
 * beside its field; the server checks again. `website` is the honeypot the server ignores a
 * message by — hidden from people, so only a bot fills it.
 */

const TOPICS = [
  { value: 'account', label: 'My account or signing in' },
  { value: 'payment', label: 'A payment or receipt' },
  { value: 'daily-quiz', label: 'The Daily Quiz or a prize' },
  { value: 'olympiad', label: 'The Olympiad itself' },
  { value: 'other', label: 'Something else' },
] as const

type Errors = Partial<Record<'name' | 'email' | 'topic' | 'message', string>>

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function ContactForm() {
  const { state } = useAuth()
  const student = state.status === 'student' ? state.student : null
  const [name, setName] = useState(student?.fullName ?? '')
  const [email, setEmail] = useState(student?.email ?? '')
  const [topic, setTopic] = useState('')
  const [message, setMessage] = useState('')
  const [website, setWebsite] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function check(): Errors {
    const next: Errors = {}
    if (name.trim().length < 2) next.name = 'Tell us your name.'
    if (!EMAIL.test(email.trim())) next.email = 'Enter an email address we can reply to.'
    if (!topic) next.topic = 'Choose what your message is about.'
    if (message.trim().length < 10) next.message = 'Write a little more, so we can help — at least 10 characters.'
    else if (message.trim().length > 2000) next.message = 'Keep your message under 2,000 characters.'
    return next
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setFailure(null)
    const next = check()
    setErrors(next)
    if (Object.keys(next).length > 0) return
    setBusy(true)
    try {
      const res = await api.post<{ message: string }>('/contact', { name, email, topic, message, website })
      setSent(res.message)
    } catch (err) {
      setFailure(humanizeError(err, { fallback: 'Your message could not be sent just now. Please try again, or email us directly.' }))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Alert tone="success" title="Message sent">
        {sent}
      </Alert>
    )
  }

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)} noValidate>
      {failure && <Alert tone="danger">{failure}</Alert>}
      <div className={styles.formGrid}>
        <Field label="Your name" required error={errors.name}>
          <Input autoComplete="name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Your email" required error={errors.email} hint="We reply to this address.">
          <Input type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
      </div>
      <Field label="What is it about?" required error={errors.topic}>
        <Select value={topic} onChange={(event) => setTopic(event.target.value)}>
          <option value="">Choose one</option>
          {TOPICS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Your message" required error={errors.message} hint="Include your student ID if you have one.">
        <Textarea rows={6} maxLength={2000} value={message} onChange={(event) => setMessage(event.target.value)} />
      </Field>
      {/* The honeypot: off screen, out of the tab order and hidden from assistive technology. */}
      <div className={styles.trap} aria-hidden="true">
        <label>
          Leave this empty
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
        </label>
      </div>
      <div>
        <Button type="submit" icon="ph-paper-plane-tilt" loading={busy}>
          Send message
        </Button>
      </div>
    </form>
  )
}
