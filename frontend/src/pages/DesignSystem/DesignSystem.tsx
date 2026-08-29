import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ApiError } from '../../api/client'
import ThemeToggle from '../../components/ThemeToggle'
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  DataCard,
  DataCardList,
  DataRow,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  Input,
  Modal,
  Pagination,
  Progress,
  SearchInput,
  Select,
  Skeleton,
  SkeletonCards,
  SkeletonTable,
  SkeletonText,
  Steps,
  Spinner,
  StatTile,
  Table,
  TableScroll,
  TabPanel,
  Tabs,
  Textarea,
  Tooltip,
  useToast,
} from '../../components/ui'
import styles from './DesignSystem.module.css'

/**
 * The design-system reference — **development only**, never routed in production
 * (see the note beside its import in `App.tsx`).
 *
 * Its job is to make inconsistency visible. Every primitive appears here in every
 * variant it supports, on one page, so that a change to a token can be checked against
 * the whole system in both themes and at every breakpoint rather than discovered three
 * pages later. The live viewport read-out at the top is there for exactly that: the
 * responsive audit in Phase G is a list of widths, and this is where the primitives
 * are checked against them.
 *
 * It contains **no product data and makes no API call.** The strings are obviously
 * fictional and labelled as samples, so nothing here can be mistaken for a real
 * figure — the "no fake data" rule applies to a reference page too.
 */

const TONES = ['neutral', 'primary', 'success', 'warning', 'danger', 'info', 'accent'] as const
const ALERT_TONES = ['info', 'success', 'warning', 'danger', 'neutral'] as const

const SAMPLE_ICONS = [
  'ph-squares-four',
  'ph-users-three',
  'ph-file-text',
  'ph-target',
  'ph-exam',
  'ph-calendar-dots',
  'ph-chart-line-up',
  'ph-gear-six',
  'ph-upload-simple',
  'ph-download-simple',
  'ph-magnifying-glass',
  'ph-pencil-simple',
  'ph-trash',
  'ph-check-circle',
  'ph-warning',
  'ph-warning-circle',
  'ph-sparkle',
  'ph-currency-inr',
  'ph-trophy',
  'ph-bell',
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      {label && <p className={styles.rowLabel}>{label}</p>}
      <div className="cluster">{children}</div>
    </div>
  )
}

const DEMO_STEPS = [
  { id: 'upload', label: 'Upload' },
  { id: 'review', label: 'Review' },
  { id: 'saved', label: 'Saved' },
]

export default function DesignSystem() {
  const toast = useToast()
  const [width, setWidth] = useState(window.innerWidth)
  const [modal, setModal] = useState<'none' | 'plain' | 'danger'>('none')
  const [tab, setTab] = useState('overview')
  const [pillTab, setPillTab] = useState('all')
  const [page, setPage] = useState(3)
  const [search, setSearch] = useState('Aarav')
  const [checked, setChecked] = useState(true)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className="container">
          <div className={styles.headerInner}>
            <div>
              <p className="eyebrow">Development only</p>
              <h1 className={styles.h1}>Design system</h1>
              <p className={styles.lead}>
                Every primitive, every variant. Resize the window and switch the theme — an
                inconsistency here is an inconsistency in twenty-nine pages.
              </p>
            </div>
            <div className={styles.headerSide}>
              <span className={styles.viewport}>
                <Icon name="ph-ruler" weight="bold" size="sm" />
                {width}px
              </span>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className={`container ${styles.main}`}>
        <Section title="Colour">
          <p className={styles.note}>
            Semantic tokens only. A component never names a palette step, so re-pointing one
            of these changes the whole product at once.
          </p>
          <div className={styles.swatches}>
            {[
              ['--bg', 'bg'],
              ['--bg-subtle', 'bg-subtle'],
              ['--surface', 'surface'],
              ['--surface-sunken', 'surface-sunken'],
              ['--surface-hover', 'surface-hover'],
              ['--border', 'border'],
              ['--border-strong', 'border-strong'],
              ['--primary', 'primary'],
              ['--primary-hover', 'primary-hover'],
              ['--primary-soft', 'primary-soft'],
              ['--accent', 'accent'],
              ['--success', 'success'],
              ['--warning', 'warning'],
              ['--danger', 'danger'],
              ['--info', 'info'],
              ['--text', 'text'],
              ['--text-body', 'text-body'],
              ['--text-muted', 'text-muted'],
            ].map(([token, name]) => (
              <div key={token} className={styles.swatch}>
                <span className={styles.swatchChip} style={{ background: `var(${token})` }} />
                <span className={styles.swatchName}>{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Typography">
          <div className={styles.typeStack}>
            <p style={{ fontSize: 'var(--text-4xl)', fontFamily: 'var(--font-heading)', fontWeight: 700, margin: 0, lineHeight: 1.1 }}>
              A national mathematics olympiad
            </p>
            <p className={styles.typeMeta}>text-4xl · Poppins 700 · fluid</p>

            <h1 style={{ margin: 0 }}>Heading 1 — text-3xl</h1>
            <h2 style={{ margin: 0 }}>Heading 2 — text-2xl</h2>
            <h3 style={{ margin: 0 }}>Heading 3 — text-xl</h3>
            <h4 style={{ margin: 0 }}>Heading 4 — text-lg</h4>

            <p style={{ margin: 0 }}>
              Body copy at text-md in Inter. Practice, mock tests and the daily challenge are
              free; the entry fee covers the official Olympiad only. Long words such as
              <code> AMIT_0000</code> wrap rather than pushing the page sideways.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
              Secondary copy at text-sm, muted — 4.76:1, the lightest text allowed.
            </p>
            <p className="eyebrow" style={{ margin: 0 }}>Eyebrow · text-2xs uppercase</p>
            <p className="mono" style={{ margin: 0 }}>Mono 1234567890 · tabular figures</p>
          </div>
        </Section>

        <Section title="Buttons">
          <Row label="Variants">
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="subtle">Subtle</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </Row>
          <Row label="Sizes">
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
            <Button pill size="lg" icon="ph-arrow-right">
              Pill, for a hero
            </Button>
          </Row>
          <Row label="Icons, loading, disabled">
            <Button icon="ph-plus">With icon</Button>
            <Button iconAfter="ph-arrow-right" variant="secondary">
              Continue
            </Button>
            <Button loading>Saving</Button>
            <Button disabled>Disabled</Button>
            <Button iconOnly icon="ph-pencil-simple" aria-label="Edit question" variant="secondary" />
            <Button iconOnly icon="ph-trash" aria-label="Delete question" variant="ghost" />
            <ButtonLink to="/design-system" variant="outline" icon="ph-link">
              Link that looks like a button
            </ButtonLink>
          </Row>
          <Row label="Full width (mobile default)">
            <div style={{ width: '100%', maxWidth: 320 }}>
              <Button fullWidth icon="ph-check">
                Submit
              </Button>
            </div>
          </Row>
        </Section>

        <Section title="Badges">
          {(['soft', 'solid', 'outline'] as const).map((variant) => (
            <Row key={variant} label={variant}>
              {TONES.map((tone) => (
                <Badge key={tone} tone={tone} variant={variant}>
                  {tone}
                </Badge>
              ))}
            </Row>
          ))}
          <Row label="With icon, dot, uppercase">
            <Badge tone="success" icon="ph-check-circle">
              Paid
            </Badge>
            <Badge tone="warning" icon="ph-clock">
              Pending
            </Badge>
            <Badge tone="danger" icon="ph-x-circle">
              Failed
            </Badge>
            <Badge tone="neutral" dot>
              Not started
            </Badge>
            <Badge tone="primary" uppercase size="sm">
              Draft
            </Badge>
          </Row>
        </Section>

        <Section title="Alerts">
          <div className="stack">
            {ALERT_TONES.map((tone) => (
              <Alert key={tone} tone={tone} title={`${tone} alert`}>
                One sentence explaining what happened, in the reader&apos;s terms.
              </Alert>
            ))}
            <Alert
              tone="danger"
              title="This question cannot be published"
              actions={
                <>
                  <Button size="sm" variant="danger">
                    Fix now
                  </Button>
                  <Button size="sm" variant="ghost">
                    Later
                  </Button>
                </>
              }
              onDismiss={() => toast.info('Alert dismissed')}
            >
              A published question must have a solution a student can read.
            </Alert>
          </div>
        </Section>

        <Section title="Forms">
          <Card>
            <CardHeader
              title="Field, Input, Select, Textarea, Checkbox"
              description="Labels are required by the type. A placeholder is never a label."
            />
            <div className={styles.formGrid}>
              <Field label="Full name" required hint="As it should appear on the certificate">
                <Input placeholder="Aarav Sharma" />
              </Field>
              <Field label="Email address" required error="Enter an email address we can reach">
                <Input type="email" defaultValue="not-an-email" />
              </Field>
              <Field label="Mobile number" hint="Numeric keypad via inputMode, not type=number">
                <Input type="tel" inputMode="numeric" placeholder="9782870716" icon="ph-phone" />
              </Field>
              <Field label="Marks" optional>
                <Input inputMode="numeric" defaultValue="4" suffix="marks" />
              </Field>
              <Field label="Class" required>
                <Select defaultValue="Class 8">
                  <option>Class 3</option>
                  <option>Class 8</option>
                  <option>Class 12</option>
                </Select>
              </Field>
              <Field label="Disabled" hint="Read-only surface, muted text">
                <Input disabled defaultValue="Cannot be edited" />
              </Field>
              <Field label="Solution" hint="Shown to the student after submission" className={styles.span2}>
                <Textarea placeholder="Explain the working, step by step" />
              </Field>
              <div className={styles.span2}>
                <SearchInput
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onClear={() => setSearch('')}
                  aria-label="Search students"
                  placeholder="Search by name, ID or school"
                />
              </div>
              <div className={styles.span2}>
                <Checkbox
                  label="Charge an entry fee"
                  description="Turning this off admits every registered student to the Olympiad."
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
              </div>
            </div>
            <CardFooter>
              <Button variant="ghost">Cancel</Button>
              <Button icon="ph-check">Save</Button>
            </CardFooter>
          </Card>
        </Section>

        <Section title="Cards">
          <div className="grid-auto" style={{ '--grid-min': '260px' } as CSSProperties}>
            <Card>
              <CardHeader title="Default" description="Surface, border, small shadow." size="sm" as="h3" />
              <CardBody>Padding is fluid: 16px on a phone, 24px when there is room.</CardBody>
            </Card>
            <Card tone="sunken">
              <CardHeader title="Sunken" description="For a nested panel." size="sm" as="h3" />
              <CardBody>No shadow, recessed surface.</CardBody>
            </Card>
            <Card interactive>
              <CardHeader title="Interactive" description="Only when it is really a link." size="sm" as="h3" />
              <CardBody>Hover and focus-within treatment.</CardBody>
            </Card>
          </div>
        </Section>

        <Section title="Stat tiles">
          <div className="grid-auto" style={{ '--grid-min': '200px' } as CSSProperties}>
            <StatTile icon="ph-users-three" label="Sample figure" value="1,253" />
            <StatTile icon="ph-currency-inr" label="Sample total" value="₹24,875" tone="success" hint="Sample only" />
            <StatTile icon="ph-clock-countdown" label="Sample pending" value="7" tone="warning" />
            <StatTile icon="ph-chart-line-up" label="Average score" value={null} hint="null renders an em dash, never 0" />
          </div>
        </Section>

        <Section title="Tabs">
          <Tabs
            idPrefix="ds-tabs"
            label="Design system examples"
            value={tab}
            onChange={setTab}
            items={[
              { id: 'overview', label: 'Overview', icon: 'ph-squares-four' },
              { id: 'review', label: 'Needs review', icon: 'ph-eye', count: 12 },
              { id: 'rejected', label: 'Rejected', count: 0 },
              { id: 'locked', label: 'Disabled', disabled: true },
            ]}
          />
          {(['overview', 'review', 'rejected'] as const).map((id) => (
            <TabPanel key={id} idPrefix="ds-tabs" id={id} active={tab === id}>
              <p style={{ margin: 0 }}>
                Panel for <strong>{id}</strong>. Each tab has one, which is what makes
                <code> aria-controls</code> resolve — arrow keys move between tabs, and the next
                Tab press lands here.
              </p>
            </TabPanel>
          ))}

          <p className={styles.note}>
            The same control in <strong>filter</strong> mode: a labelled group of toggles with
            <code> aria-pressed</code>, no panels and no dangling <code>aria-controls</code>.
          </p>
          <Tabs
            idPrefix="ds-pills"
            variant="pill"
            mode="filter"
            label="Filter questions by status"
            value={pillTab}
            onChange={setPillTab}
            items={[
              { id: 'all', label: 'All' },
              { id: 'draft', label: 'Draft' },
              { id: 'published', label: 'Published' },
            ]}
          />
          <p className={styles.note}>Filtering by: {pillTab}</p>
        </Section>

        <Section title="Table, and its mobile form">
          <Card padding="none">
            <TableScroll label="Sample rows">
              <Table density="compact">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th>School</th>
                    <th>Registered</th>
                    <th>Payment</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Sample A.', 'Class 8', 'Sample School, Jaipur', '12 Aug 2026', 'paid', '38 / 50'],
                    ['Sample B.', 'Class 10', 'Sample Public School', '14 Aug 2026', 'pending', '—'],
                    ['Sample C.', 'Class 12', 'Sample Academy', '19 Aug 2026', 'failed', '—'],
                  ].map((row) => (
                    <tr key={row[0]}>
                      <td>{row[0]}</td>
                      <td>{row[1]}</td>
                      <td>{row[2]}</td>
                      <td>{row[3]}</td>
                      <td>
                        <Badge
                          tone={row[4] === 'paid' ? 'success' : row[4] === 'pending' ? 'warning' : 'danger'}
                          icon={row[4] === 'paid' ? 'ph-check-circle' : row[4] === 'pending' ? 'ph-clock' : 'ph-x-circle'}
                          size="sm"
                        >
                          {row[4]}
                        </Badge>
                      </td>
                      <td>{row[5]}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          </Card>

          <p className={styles.note}>The same three records as cards — what a listing shows on a phone.</p>
          <DataCardList>
            {[
              { name: 'Sample A.', id: 'AMIT_0001', klass: 'Class 8', state: 'paid' as const },
              { name: 'Sample B.', id: 'AMIT_0002', klass: 'Class 10', state: 'pending' as const },
            ].map((record) => (
              <DataCard
                key={record.id}
                title={record.name}
                subtitle={record.id}
                status={
                  <Badge tone={record.state === 'paid' ? 'success' : 'warning'} size="sm">
                    {record.state}
                  </Badge>
                }
                actions={
                  <>
                    <Button size="sm" variant="secondary" icon="ph-eye">
                      View
                    </Button>
                    <Button size="sm" variant="ghost" icon="ph-download-simple">
                      Invoice
                    </Button>
                  </>
                }
              >
                <DataRow label="Class">{record.klass}</DataRow>
                <DataRow label="School">Sample School, Jaipur</DataRow>
                <DataRow label="Registered">12 Aug 2026</DataRow>
              </DataCard>
            ))}
          </DataCardList>

          <Pagination page={page} pageCount={12} onChange={setPage} total={238} pageSize={20} label="Sample pages" />
        </Section>

        <Section title="Steps">
          <p className="muted">
            A state display, not navigation: you reach the next step by doing the work. The middle step of a
            writing flow stays named <strong>Review</strong> — a previewed import has written nothing. Below
            480px only the current label is shown; the numbers carry the sequence.
          </p>
          <Card>
            <Steps steps={DEMO_STEPS} current="upload" label="Steps, at the start" />
            <Steps steps={DEMO_STEPS} current="review" label="Steps, in the middle" />
            <Steps steps={DEMO_STEPS} current="saved" label="Steps, at the end" />
          </Card>
        </Section>

        <Section title="Loading">
          <div className="grid-auto" style={{ '--grid-min': '280px' } as CSSProperties}>
            <Card>
              <CardHeader title="Skeleton text" size="sm" as="h3" />
              <SkeletonText lines={4} />
            </Card>
            <Card>
              <CardHeader title="Skeleton table" size="sm" as="h3" />
              <SkeletonTable rows={4} columns={4} />
            </Card>
            <Card>
              <CardHeader title="Spinner" size="sm" as="h3" />
              <Spinner label="Loading" />
            </Card>
            <Card>
              <CardHeader title="Inline" size="sm" as="h3" />
              <p style={{ margin: 0 }}>
                <Spinner inline /> Checking the referral code…
              </p>
              <p style={{ margin: '12px 0 0' }}>
                <Skeleton width={120} height={12} /> a bare shape
              </p>
            </Card>
          </div>
          <SkeletonCards count={3} />
        </Section>

        <Section title="Progress">
          <div className="stack" style={{ '--stack-gap': 'var(--space-5)' } as CSSProperties}>
            <Progress label="Questions answered" value={12} max={20} valueText="12 of 20 answered" />
            <Progress label="Marks" value={38} max={50} tone="success" size="sm" />
            <Progress label="Rows validated" value={140} max={500} tone="warning" />
            <Progress indeterminate label="Reading the file" />
            <p className={styles.note}>
              The indeterminate bar is for work whose length is unknown. No invented percentages.
            </p>
          </div>
        </Section>

        <Section title="Empty and error states">
          <div className="grid-auto" style={{ '--grid-min': '320px' } as CSSProperties}>
            <Card>
              <EmptyState
                icon="ph-exam"
                title="No mock tests yet"
                description="Nothing has been published for Class 8. New papers appear here as soon as they are released."
                action={<Button variant="secondary" icon="ph-target">Practise instead</Button>}
              />
            </Card>
            <Card>
              <EmptyState
                size="sm"
                icon="ph-magnifying-glass"
                title="No students match these filters"
                description="Try a different class, or clear the payment filter."
                action={<Button size="sm" variant="ghost" icon="ph-x">Clear filters</Button>}
              />
            </Card>
            <Card>
              <ErrorState error={new ApiError('Something failed', 500)} onRetry={() => toast.info('Retried')} />
            </Card>
            <Card>
              <ErrorState error={new ApiError('Your session has ended', 401)} />
            </Card>
          </div>
        </Section>

        <Section title="Dialogs and toasts">
          <Row label="Modal">
            <Button variant="secondary" icon="ph-browsers" onClick={() => setModal('plain')}>
              Open dialog
            </Button>
            <Button variant="danger" icon="ph-warning" onClick={() => setModal('danger')}>
              Open destructive dialog
            </Button>
          </Row>
          <Row label="Toasts">
            <Button size="sm" variant="secondary" onClick={() => toast.success('Answer saved')}>
              Success
            </Button>
            <Button size="sm" variant="secondary" onClick={() => toast.info('Nothing to import')}>
              Information
            </Button>
            <Button size="sm" variant="secondary" onClick={() => toast.warning('Two rows need review')}>
              Warning
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => toast.error('This could not be saved', 'The question has no solution.')}
            >
              Error
            </Button>
          </Row>
        </Section>

        <Section title="Tooltip">
          <Row label="Hover or focus — supplementary only">
            <Tooltip content="XP is the sum of every activity you have been awarded for.">
              <Button size="sm" variant="ghost" icon="ph-question">
                What is XP?
              </Button>
            </Tooltip>
            <Tooltip placement="bottom" content="Below the trigger.">
              <Button size="sm" variant="ghost">
                Placement: bottom
              </Button>
            </Tooltip>
          </Row>
        </Section>

        <Section title="Icons">
          <p className={styles.note}>
            Phosphor, regular and bold only — no other weight has a stylesheet loaded, and a
            missing weight renders nothing at all.
          </p>
          <div className={styles.iconGrid}>
            {SAMPLE_ICONS.map((name) => (
              <span key={name} className={styles.iconCell}>
                <Icon name={name} weight="bold" size="lg" />
                <span className={styles.iconName}>{name.replace('ph-', '')}</span>
              </span>
            ))}
          </div>
        </Section>
      </main>

      <Modal
        open={modal === 'plain'}
        onClose={() => setModal('none')}
        title="Release results to the cohort"
        description="Every student who sat this paper is notified once."
        icon="ph-megaphone"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModal('none')}>
              Cancel
            </Button>
            <Button icon="ph-check" onClick={() => setModal('none')}>
              Release results
            </Button>
          </>
        }
      >
        <p>
          Focus is trapped while this is open, Escape closes it, and focus returns to the button
          that opened it. On a phone this is a bottom sheet.
        </p>
        <Field label="Message to include" optional>
          <Textarea rows={3} placeholder="Optional note" />
        </Field>
      </Modal>

      <Modal
        open={modal === 'danger'}
        onClose={() => setModal('none')}
        dismissible={false}
        tone="danger"
        icon="ph-warning"
        size="sm"
        title="Delete every question?"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setModal('none')}>
              Keep them
            </Button>
            <Button variant="danger" icon="ph-trash" onClick={() => setModal('none')}>
              Delete
            </Button>
          </>
        }
      >
        <p>
          <strong>dismissible=false</strong> — neither Escape nor a press outside closes this one.
          A decision this size has to be answered.
        </p>
      </Modal>
    </div>
  )
}
