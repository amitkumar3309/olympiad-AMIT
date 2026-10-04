import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowRight, Flame, Star, Target, Trophy, ChartColumn } from 'lucide-react'
import { ApiError } from '../../api/client'
import ThemeToggle from '../../components/ThemeToggle'
import MathText from '../../components/MathText'
import DailyQuizFab from '../../components/DailyQuizFab'
import Illustration from '../../components/Illustration'
import { ILLUSTRATION_NAMES } from '../../components/illustrations'
import { formatDateTime } from '../../lib/format'
import {
  ActivityList,
  Alert,
  Avatar,
  Badge,
  Breadcrumb,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Confetti,
  Countdown,
  CountUp,
  IconTile,
  JourneyTrack,
  LeaderboardTable,
  Menu,
  OptionGroup,
  OptionTile,
  Podium,
  Reveal,
  Section,
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

/** Sample options for the option-tile specimen. The question is the launch mockup's,
    with its options corrected (the mockup offered none that was right: the answer is
    123/7 — see `LAUNCH_SPEC.md`, Appendix B). */
const SAMPLE_OPTIONS = [
  { id: 'o-7f3a', tex: '$\\frac{115}{7}$' },
  { id: 'o-2c91', tex: '$\\frac{119}{7}$' },
  { id: 'o-9d04', tex: '$\\frac{123}{7}$' },
  { id: 'o-51be', tex: '$\\frac{127}{7}$' },
]
const LETTERS = ['A', 'B', 'C', 'D']

const SAMPLE_JOURNEY = [
  { key: 'm1', caption: 'Month 1', title: 'Number Forest', state: 'done' as const },
  { key: 'm2', caption: 'Month 2', title: 'Logic Valley', state: 'done' as const },
  { key: 'm3', caption: 'Month 3', title: 'Algebra Castle', state: 'current' as const },
  { key: 'm4', caption: 'Month 4', title: 'Geometry Temple', state: 'locked' as const },
  { key: 'm5', caption: 'Month 5', title: 'Speed Arena', state: 'locked' as const },
  { key: 'm6', caption: 'Month 6', title: 'Olympiad Kingdom', state: 'locked' as const },
]
const JOURNEY_ART = [
  'journey-number-forest',
  'journey-logic-valley',
  'journey-algebra-castle',
  'journey-geometry-temple',
  'journey-speed-arena',
  'journey-olympiad-kingdom',
] as const

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

/**
 * A band of this reference page.
 *
 * Renamed from `Section` in Milestone 26, when `ui/Section` arrived and the two names
 * collided. Deliberately **not** replaced by `ui/Section`: this page has to be able to
 * show that component as a specimen, and a reference page built out of the thing it is
 * demonstrating cannot show it failing.
 */
function Group({ title, children }: { title: string; children: ReactNode }) {
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
  const [choice, setChoice] = useState<string | null>(null)
  const [burst, setBurst] = useState<number | null>(null)
  // Sample instants for the countdown specimens, fixed at mount.
  const [instants] = useState(() => {
    const now = Date.now()
    return {
      inTwoDays: new Date(now + (2 * 86_400 + 14 * 3_600 + 37 * 60) * 1000),
      inFiveHours: new Date(now + (5 * 3_600 + 12 * 60) * 1000),
      startedAgo: new Date(now - (1 * 60 + 47) * 1000),
    }
  })

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
        <Group title="Colour">
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
              ['--surface-mint', 'surface-mint'],
              ['--surface-cream', 'surface-cream'],
              ['--surface-aqua', 'surface-aqua'],
              ['--progress-track', 'progress-track'],
              ['--live', 'live'],
              ['--series-1', 'series-1'],
              ['--series-2', 'series-2'],
              ['--series-3', 'series-3'],
              ['--series-4', 'series-4'],
              ['--series-5', 'series-5'],
              ['--podium-gold', 'podium-gold'],
              ['--podium-silver', 'podium-silver'],
              ['--podium-bronze', 'podium-bronze'],
              ['--gradient-primary', 'gradient-primary'],
            ].map(([token, name]) => (
              <div key={token} className={styles.swatch}>
                <span className={styles.swatchChip} style={{ background: `var(${token})` }} />
                <span className={styles.swatchName}>{name}</span>
              </div>
            ))}
          </div>
        </Group>

        <Group title="Typography">
          <p className={styles.note}>
            <strong>Plus Jakarta Sans, everywhere a reader reads</strong> (Milestone 30) — headings, body,
            tables, inputs. It replaces both Bricolage Grotesque and Instrument Sans, and weight carries the
            hierarchy: 800 for a hero, 700 for headings, 600 for labels, 400/500 for body. Self-hosted, with
            true tabular figures (<span className="tnum">111</span> and <span className="tnum">000</span>
            measure the same) and the rupee sign in its own face: ₹199. Geist Mono stays for serials, Cinzel
            for the printed certificate, Caveat for two handwritten accents and nothing else.
          </p>
          <div className={styles.typeStack}>
            <p
              style={{
                fontSize: 'var(--type-hero)',
                fontWeight: 'var(--weight-black)' as CSSProperties['fontWeight'],
                letterSpacing: 'var(--tracking-display)',
                margin: 0,
                lineHeight: 'var(--leading-tight)',
                color: 'var(--text)',
              }}
            >
              Sample hero <span style={{ color: 'var(--primary)' }}>2027</span>
            </p>
            <p className={styles.typeMeta}>--type-hero · 800 · fluid 36 → 56px</p>

            <h1 style={{ margin: 0 }}>Page title — --type-page-title · 700 · 26 → 32px</h1>
            <h2 style={{ margin: 0 }}>Section title — --type-section-title · 700 · 22 → 28px</h2>
            <h3 style={{ margin: 0 }}>Card title — --type-card-title · 700 · 16 → 18px</h3>
            <h4 style={{ margin: 0 }}>Heading 4 — text-md · 700</h4>

            <p style={{ margin: 0 }}>
              Body copy at the element default — <code>--type-body</code>, 15px on a phone and 16px on a
              desktop, weight 400, leading 1.5. Long words such as <code>AMIT_0000</code> wrap rather than
              pushing the page sideways.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 'var(--type-small)' }}>
              Small, muted — <code>--type-small</code> (13px) in navy ink at 64%: 5.14:1 at its worst, on
              the purple tint. Nothing lighter carries words.
            </p>
            <p style={{ margin: 0, fontSize: 'var(--type-micro)', color: 'var(--text-muted)' }}>
              Micro — <code>--type-micro</code> (12px), for a delta or a timestamp.
            </p>
            <p className="eyebrow" style={{ margin: 0 }}>Eyebrow · text-2xs uppercase</p>
            <p className="mono" style={{ margin: 0 }}>Geist Mono 1234567890 · tabular figures</p>
            <p style={{ margin: 0, fontFamily: 'var(--font-hand)', fontSize: 'var(--type-page-title)', color: 'var(--primary-text)' }}>
              Think · Solve · Grow
            </p>
            <p className={styles.typeMeta}>--font-hand (Caveat) — the two handwritten accents only</p>
          </div>
        </Group>

        {/* ------------------------------------------- the Milestone 26 primitives */}
        <Group title="Section — the page's rhythm unit">
          <p className={styles.note}>
            Eyebrow → heading → lead → content, and with <code>titleAs=&quot;h1&quot; size=&quot;page&quot;</code>
            it is also the page header. There is deliberately no separate <code>PageHeader</code>: the two are
            the same shape at two sizes. It also wires its own <code>aria-labelledby</code>, so a section
            cannot end up as an unnamed landmark.
          </p>
          <Card padding="lg">
            <Section
              as="div"
              eyebrow="What you get"
              title="Four ways to prepare, all of them free"
              titleAs="h3"
              lead="The lead is capped at a 62-character measure. A line of body copy spanning a 1200px container is genuinely hard to track back from."
              actions={
                <Button size="sm" variant="secondary">
                  An action
                </Button>
              }
            >
              <p style={{ margin: 0 }}>Content sits here, one --block-gap below the header.</p>
            </Section>
          </Card>
          <Row label="Compact — inside a card, under a section heading">
            <div style={{ width: '100%' }}>
              <Card tone="sunken" padding="md">
                <Section
                  as="div"
                  title="Compact section"
                  titleAs="h3"
                  size="compact"
                  lead="Smaller title, tighter rhythm."
                  divider
                >
                  <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>With a divider under the header.</p>
                </Section>
              </Card>
            </div>
          </Row>
        </Group>

        <Group title="IconTile — a tint with a saturated glyph">
          <p className={styles.note}>
            <strong>A pale tint and a saturated glyph</strong>, as in the launch mockups — the gold star on
            cream, the orange flame on peach. Each glyph is solved to at least 3:1 on its own tint; the
            mockup&rsquo;s own gold star measures 2.2:1, which is why the gold glyph is a deeper gold than
            the XP colour. The hard diagonal edge of Milestone 27 is retired. Tones are buckets, never
            status and never words — <code>Badge</code> carries meaning.
          </p>
          <Row label="Tones — categories, never actions and never words">
            <IconTile icon="ph-target" tone="blue" />
            <IconTile icon="ph-exam" tone="orange" />
            <IconTile icon="ph-calendar-check" tone="magenta" />
            <IconTile icon="ph-chart-line-up" tone="green" />
            <IconTile icon="ph-sparkle" tone="purple" />
            <IconTile icon="ph-bell" tone="lilac" />
            <IconTile icon="ph-gear-six" tone="neutral" />
            <IconTile icon="ph-trophy" tone="gold" />
          </Row>
          <Row label="Sizes and shapes">
            <IconTile icon="ph-target" tone="blue" size="sm" />
            <IconTile icon="ph-target" tone="blue" size="md" />
            <IconTile icon="ph-target" tone="blue" size="lg" />
            <IconTile icon="ph-check-circle" tone="green" shape="circle" size="sm" />
            <IconTile icon="ph-check-circle" tone="green" shape="circle" size="md" />
          </Row>
        </Group>

        <Group title="Avatar">
          <p className={styles.note}>
            <code>name</code> is required — it is the initials <em>and</em> the image&apos;s alternative text.
            A failed photograph falls back to initials rather than to the browser&apos;s broken-image glyph,
            which matters because photographs come from an authenticated endpoint: an expired session would
            otherwise break every avatar on the page.
          </p>
          <Row label="Sizes (sample names)">
            <Avatar name="Aarav Sharma" size="xs" />
            <Avatar name="Aarav Sharma" size="sm" />
            <Avatar name="Priya Iyer" size="md" />
            <Avatar name="Mohammed Ali Khan" size="lg" />
            <Avatar name="Amit" size="md" />
          </Row>
          <Row label="A broken source falls back; it does not show a broken image">
            <Avatar name="Sneha Rao" src="/this-photo-does-not-exist.png" size="md" />
          </Row>
          <Row label="tint — other students on a public board are always initials, coloured by name">
            <Avatar name="Sample Rehaan M." size="md" tint />
            <Avatar name="Sample Priyal K." size="md" tint />
            <Avatar name="Sample Vivaan P." size="md" tint />
            <Avatar name="Sample Ishita M." size="md" tint />
            <Avatar name="Sample Kunal T." size="md" tint />
            <Avatar name="Sample Ananya P." size="md" tint />
          </Row>
        </Group>

        <Group title="Menu — row actions">
          <p className={styles.note}>
            One trigger instead of five small buttons at the end of every table row. The panel is portalled
            and positioned from the trigger, so <code>TableScroll</code>&apos;s overflow cannot clip it; any
            scroll closes it rather than leaving it floating beside nothing. A disabled item states
            <em> why</em> in the panel — a <code>title</code> never appears on a touch screen.
          </p>
          <Row label="Icon-only and labelled">
            <Menu
              label="Actions for a sample row"
              items={[
                { label: 'Edit', icon: 'ph-pencil-simple', onSelect: () => toast.info('Sample: edit') },
                { label: 'Duplicate', icon: 'ph-copy', onSelect: () => toast.info('Sample: duplicate') },
                { separator: true },
                {
                  label: 'Release results',
                  icon: 'ph-megaphone',
                  disabled: true,
                  disabledReason: 'The exam window has to close first — a rank is a fact about the whole cohort.',
                },
                { label: 'Delete', icon: 'ph-trash', tone: 'danger', onSelect: () => toast.info('Sample: delete') },
              ]}
            />
            <Menu
              label="More actions for a sample row"
              triggerLabel="More"
              triggerIcon="ph-caret-down"
              align="start"
              items={[
                { label: 'Export as .xlsx', icon: 'ph-file-xls', onSelect: () => toast.info('Sample: export') },
                { label: 'Print', icon: 'ph-printer', onSelect: () => toast.info('Sample: print') },
              ]}
            />
          </Row>
        </Group>

        <Group title="Breadcrumb">
          <p className={styles.note}>
            The last item is the page you are on: text, marked <code>aria-current=&quot;page&quot;</code>, never
            a link. A link to the current page is a control that appears to do something and does nothing.
          </p>
          <Row>
            <Breadcrumb
              items={[
                { label: 'Question Bank', to: '/design-system' },
                { label: 'Class 9 · Trigonometry', to: '/design-system' },
                { label: 'Edit question' },
              ]}
            />
          </Row>
        </Group>

        <Group title="Buttons">
          <p className={styles.note}>
            <strong>Flat pills, one action colour</strong> (Milestone 30). Emphasis is fill versus
            outline: <code>primary</code> is the solid brand blue (white label, 5.04:1),
            <code> secondary</code> the mockups&rsquo; white pill with a hairline, <code>link</code> text with
            an arrow. <code>brand</code> is the same blue with a soft glow, for the one loudest action on a
            page — use it once. Pressing is a 0.98 scale; the keycap edge is retired.
          </p>
          <Row label="Variants">
            <Button variant="primary">Primary</Button>
            <Button variant="brand" iconAfter={<ArrowRight size={18} />}>
              Brand
            </Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="subtle">Subtle</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="link" iconAfter={<ArrowRight size={16} />}>
              View all
            </Button>
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
        </Group>

        <Group title="Badges">
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
          <Row label="The launch pills — LIVE, a countdown chip, difficulty, Soon">
            <Badge tone="success" live uppercase size="sm">
              Live
            </Badge>
            <Badge tone="danger">2d 14h</Badge>
            <Badge tone="neutral">Moderate</Badge>
            <Badge tone="primary">Class 10</Badge>
            <Badge tone="neutral" variant="outline" size="sm">
              Soon
            </Badge>
          </Row>
        </Group>

        <Group title="Alerts">
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
        </Group>

        <Group title="Forms">
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
        </Group>

        <Group title="Cards">
          <p className={styles.note}>
            <strong>A white card on the pale blue page, with a hairline and a soft two-layer shadow</strong>,
            at a 16px radius (Milestone 30). Both edges, together: the fill step alone is 1.05:1 and a
            shadow alone reads as a smudge in sunlight. In the dark theme <code>--card-shadow</code> is
            <code> none</code> and the blue hairline does the work. Only a card that is genuinely a link
            lifts on hover.
          </p>
          <div className="grid-auto" style={{ '--grid-min': '260px' } as CSSProperties}>
            <Card>
              <CardHeader title="Default" description="Hairline and soft shadow." size="sm" as="h3" />
              <CardBody>Padding is fluid: 16px on a phone, 24px when there is room.</CardBody>
            </Card>
            <Card style={{ background: 'var(--surface-mint)' }}>
              <CardHeader title="Tinted" description="--surface-mint, -cream, -aqua: the mockups' tinted cards." size="sm" as="h3" />
              <CardBody>A lifted surface in the dark theme, because a card holds themed text.</CardBody>
            </Card>
            <Card tone="sunken">
              <CardHeader title="Sunken" description="For a nested panel." size="sm" as="h3" />
              <CardBody>A tinted inset, with a tighter radius than the card holding it.</CardBody>
            </Card>
            <Card interactive>
              <CardHeader title="Interactive" description="Only when it is really a link." size="sm" as="h3" />
              <CardBody>Hover and focus-within treatment.</CardBody>
            </Card>
          </div>
        </Group>

        <Group title="Stat tiles">
          <div className="grid-auto" style={{ '--grid-min': '200px' } as CSSProperties}>
            <StatTile icon="ph-users-three" label="Sample figure" value="1,253" />
            <StatTile icon="ph-currency-inr" label="Sample total" value="₹24,875" tone="success" hint="Sample only" />
            <StatTile icon="ph-clock-countdown" label="Sample pending" value="7" tone="warning" />
            <StatTile icon="ph-chart-line-up" label="Average score" value={null} hint="null renders an em dash, never 0" />
          </div>
          <p className={styles.note}>
            <strong>value-first</strong> — the mockups&rsquo; stat card: a tinted icon, the figure, the label,
            and a delta whose words carry the direction. Pass a <code>CountUp</code> as the value and it counts
            up the first time it is on screen (Indian grouping; the final value is what a screen reader hears).
          </p>
          <div className="grid-auto" style={{ '--grid-min': '180px' } as CSSProperties}>
            <StatTile
              layout="value-first"
              icon={<Star size={20} fill="currentColor" />}
              iconTone="gold"
              value={<CountUp value={1240} />}
              label="Total XP (sample)"
              delta={{ text: '+120 this week', direction: 'up' }}
            />
            <StatTile
              layout="value-first"
              icon={<Trophy size={20} />}
              iconTone="gold"
              value="#48"
              label="Global rank (sample)"
              delta={{ text: 'out of 12,458' }}
            />
            <StatTile
              layout="value-first"
              icon={<Flame size={20} />}
              iconTone="orange"
              value={<CountUp value={12} />}
              label="Day streak (sample)"
              delta={{ text: 'Keep it going!', direction: 'up' }}
            />
            <StatTile
              layout="value-first"
              icon={<Target size={20} />}
              iconTone="blue"
              value={<CountUp value={108320} />}
              label="Questions solved (sample)"
              delta={{ text: '+25 this week', direction: 'up' }}
            />
            <StatTile
              layout="value-first"
              icon={<ChartColumn size={20} />}
              iconTone="purple"
              value="75%"
              label="Accuracy (sample)"
              delta={{ text: '4 points below last month', direction: 'down' }}
            />
            <StatTile
              layout="value-first"
              icon={<ChartColumn size={20} />}
              iconTone="blue"
              value={null}
              label="Accuracy, no data (sample)"
              delta={{ text: 'Answer a question to see this' }}
            />
          </div>
        </Group>

        <Group title="Tabs">
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
        </Group>

        <Group title="Table, and its mobile form">
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
        </Group>

        <Group title="Steps">
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
        </Group>

        <Group title="Loading">
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
        </Group>

        <Group title="Progress">
          <div className="stack" style={{ '--stack-gap': 'var(--space-5)' } as CSSProperties}>
            <Progress label="Questions answered" value={12} max={20} valueText="12 of 20 answered" />
            <Progress label="Marks" value={38} max={50} tone="success" size="sm" />
            <Progress label="Rows validated" value={140} max={500} tone="warning" />
            <Progress indeterminate label="Reading the file" />
            <p className={styles.note}>
              The indeterminate bar is for work whose length is unknown. No invented percentages.
            </p>
          </div>
        </Group>

        <Group title="Empty and error states">
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
        </Group>

        <Group title="Dialogs and toasts">
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
        </Group>

        <Group title="Tooltip">
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
        </Group>

        {/* ------------------------------------------- Milestone 30: the launch primitives */}
        <Group title="Motion — CountUp and Reveal">
          <p className={styles.note}>
            Motion explains a change or points at the one thing that matters. <code>CountUp</code> counts
            once, the first time a figure is on screen; <code>Reveal</code> brings a block in once. Both
            stop under reduced motion, and both fall back to the final state on a timer if the browser never
            delivers an observer callback or an animation frame — nothing can stay hidden or half-counted.
          </p>
          <Row label="CountUp — Indian grouping">
            <span style={{ fontSize: 'var(--type-section-title)', fontWeight: 800 }}>
              <CountUp value={108320} />
            </span>
            <span style={{ fontSize: 'var(--type-section-title)', fontWeight: 800 }}>
              <CountUp value={2341} />
            </span>
          </Row>
          <div className="grid-auto" style={{ '--grid-min': '200px' } as CSSProperties}>
            {(['up', 'fade', 'rise'] as const).map((variant, i) => (
              <Reveal key={variant} variant={variant} delay={i * 120}>
                <Card tone="sunken" padding="sm">
                  <p style={{ margin: 0 }}>
                    <code>variant=&quot;{variant}&quot;</code>, delay {i * 120}ms
                  </p>
                </Card>
              </Reveal>
            ))}
          </div>
        </Group>

        <Group title="OptionTile — the A–D answer choice">
          <p className={styles.note}>
            A real radio group: arrow keys move between choices, Space selects, one Tab stop. The chosen tile
            is marked three ways — border, tint and a filled letter — and a marked answer carries an icon and
            words, never colour alone. The content is a <code>MathText</code> passed in; the tile knows
            nothing about questions.
          </p>
          <Row label="Interactive — idle, hover, selected">
            <div style={{ width: '100%' }}>
              <OptionGroup legend="Sample: choose an answer" value={choice} onChange={setChoice} columns={4}>
                {SAMPLE_OPTIONS.map((option, i) => (
                  <OptionTile key={option.id} value={option.id} letter={LETTERS[i]!}>
                    <MathText>{option.tex}</MathText>
                  </OptionTile>
                ))}
              </OptionGroup>
            </div>
          </Row>
          <Row label="Marked — the reader chose B, which was wrong; C was right. Locked.">
            <div style={{ width: '100%' }}>
              <OptionGroup legend="Sample: a marked answer" value="o-2c91" onChange={() => undefined} columns={4} disabled>
                {SAMPLE_OPTIONS.map((option, i) => (
                  <OptionTile
                    key={option.id}
                    value={option.id}
                    letter={LETTERS[i]!}
                    result={option.id === 'o-9d04' ? 'correct' : option.id === 'o-2c91' ? 'incorrect' : undefined}
                  >
                    <MathText>{option.tex}</MathText>
                  </OptionTile>
                ))}
              </OptionGroup>
            </div>
          </Row>
        </Group>

        <Group title="Countdown — a display of the server's clock">
          <p className={styles.note}>
            Every tick computes the remaining time from the wall clock plus the server offset — it never
            counts its own ticks, so a throttled tab reads correctly the moment it is looked at. At zero it
            calls <code>onComplete</code> and the page re-asks the server; it never decides a day has turned.
            <code> role=&quot;timer&quot;</code>, so a screen reader is not told every second.
          </p>
          <Row label="clock · compact · elapsed (direction=up)">
            <span style={{ fontSize: 'var(--type-section-title)' }}>
              <Countdown target={instants.inFiveHours} label="Sample: time until the answer unlocks" />
            </span>
            <Badge tone="danger">
              <Countdown target={instants.inTwoDays} variant="compact" label="Sample: time until the event" />
            </Badge>
            <span>
              Elapsed{' '}
              <Countdown target={instants.startedAgo} direction="up" label="Sample: time since you started" />
            </span>
          </Row>
          <Row label="units — the Boss Battle card">
            <Countdown target={instants.inTwoDays} variant="units" label="Sample: time until the next battle" />
          </Row>
          <p className={styles.note}>
            Dates read like the brief asks, in IST whatever the device&rsquo;s zone: {formatDateTime(instants.inTwoDays)}.
          </p>
        </Group>

        <Group title="Podium and LeaderboardTable">
          <p className={styles.note}>
            Drawn 2 – 1 – 3, read 1, 2, 3: the DOM is an ordered list in rank order. Other students are
            always initials (they are minors) and their names arrive already masked from the server. The
            table never sorts or ranks — it prints rows in the order given, which is how equal XP shows as an
            equal rank. Below: the steps rise on first view.
          </p>
          <div className={styles.split}>
            <Card>
              <Podium
                label="Sample: top three"
                entries={[
                  { rank: 1, name: 'Sample R.', value: '195 XP', meta: 'Class 12 · Delhi', avatar: <Avatar name="Sample R" tint size="lg" decorative /> },
                  { rank: 2, name: 'Sample S.', value: '185 XP', meta: 'Class 12', avatar: <Avatar name="Sample S" tint size="lg" decorative /> },
                  { rank: 3, name: 'Sample P.', value: '150 XP', meta: 'Class 5', avatar: <Avatar name="Sample P" tint size="lg" decorative /> },
                ]}
              />
            </Card>
            <Card>
              <LeaderboardTable
                caption="Sample: today's top five in Class 10, and you"
                columns={['XP']}
                rows={[
                  { key: 'a', rank: 1, name: 'Sample R.', avatar: <Avatar name="Sample R" tint size="sm" decorative />, cells: ['2,450'], rankMarker: <Trophy size={14} color="var(--medal-gold)" aria-hidden /> },
                  { key: 'b', rank: 2, name: 'Sample S.', avatar: <Avatar name="Sample S" tint size="sm" decorative />, cells: ['2,320'] },
                  { key: 'c', rank: 2, name: 'Sample T.', avatar: <Avatar name="Sample T" tint size="sm" decorative />, cells: ['2,320'] },
                  { key: 'd', rank: 4, name: 'Sample V.', avatar: <Avatar name="Sample V" tint size="sm" decorative />, cells: ['2,180'] },
                  { key: 'e', rank: 5, name: 'Sample K.', avatar: <Avatar name="Sample K" tint size="sm" decorative />, cells: ['1,050'] },
                  { key: 'me', rank: 48, name: 'Sample You', avatar: <Avatar name="Sample You" tint size="sm" decorative />, cells: ['640'], highlight: true, gapBefore: true },
                ]}
              />
            </Card>
          </div>
        </Group>

        <Group title="JourneyTrack">
          <p className={styles.note}>
            Done, current or locked — said in words to a screen reader, then repeated by a tick, a
            &ldquo;Current&rdquo; pill and a padlock. Connectors draw left to right on first view; the current
            stage breathes. On a phone it scrolls inside itself (keyboard-reachable), never the page.
          </p>
          <Card>
            <JourneyTrack
              label="Sample: six-month journey"
              stages={SAMPLE_JOURNEY.map((stage, i) => ({ ...stage, art: <Illustration name={JOURNEY_ART[i]!} /> }))}
            />
          </Card>
        </Group>

        <Group title="ActivityList">
          <Card style={{ maxWidth: 480 }}>
            <CardHeader title="Recent activity (sample)" size="sm" as="h3" actions={<Button variant="link" size="sm" iconAfter={<ArrowRight size={14} />}>View all</Button>} />
            <ActivityList
              items={[
                { key: '1', icon: 'ph-check-circle', tone: 'green', title: 'Solved a Daily Quiz (sample)', time: 'Today, 10:12 AM', value: '+20 XP' },
                { key: '2', icon: 'ph-chart-bar', tone: 'blue', title: 'Completed a practice set (sample)', time: 'Yesterday, 6:45 PM', value: '+25 XP' },
                { key: '3', icon: 'ph-trophy', tone: 'gold', title: 'Reached level 5 (sample)', time: 'Sun, 4 Oct 2026, 4:30 PM' },
              ]}
            />
          </Card>
        </Group>

        <Group title="Confetti">
          <p className={styles.note}>
            A light burst for a correct answer: CSS only, transform and opacity, at most 1.5 seconds, nothing
            under reduced motion, and it removes itself on a timer.
          </p>
          <Row>
            <div style={{ position: 'relative' }}>
              <Button onClick={() => setBurst((n) => (n ?? 0) + 1)}>Fire a burst</Button>
              <Confetti burstKey={burst} />
            </div>
          </Row>
        </Group>

        <Group title="Illustration — placeholders until the art arrives">
          <p className={styles.note}>
            Each name is drawn from <code>src/assets/illustrations/</code> when a file with that name exists
            there, and otherwise as this placeholder — a tint and one line icon, never a person and never
            text. Nothing is requested that is not there, so a missing file is never a 404. The full list is
            in <code>docs/launch/ASSETS_NEEDED.md</code>.
          </p>
          <div className={styles.illustrationGrid}>
            {ILLUSTRATION_NAMES.map((name) => (
              <figure key={name} className={styles.illustrationCell}>
                <Illustration name={name} />
                <figcaption className={styles.iconName}>{name}</figcaption>
              </figure>
            ))}
          </div>
        </Group>

        <Group title="Daily Quiz button — all four states">
          <p className={styles.note}>
            Shown in the flow here; on the homepage it is fixed bottom-right and floats. Hover or focus one
            for the light streak and the brighter glow — the &ldquo;shine&rdquo; the owner asked for. On a
            touch screen the streak sweeps by itself every few seconds.
          </p>
          <div className={styles.fabRow}>
            <DailyQuizFab placement="inline" state="guest" onClick={() => toast.info('Sample: the Login Gate would open')} />
            <DailyQuizFab placement="inline" state="live" to="/design-system" />
            <DailyQuizFab placement="inline" state="done" to="/design-system" detail="Answer unlocks in 5h 12m" />
            <DailyQuizFab placement="inline" state="upcoming" to="/design-system" detail="Next quiz in 2h 10m" />
            <DailyQuizFab placement="inline" state="live" to="/design-system" collapsed />
          </div>
        </Group>

        <Group title="Icons">
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
        </Group>
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
