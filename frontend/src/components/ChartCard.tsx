import { useEffect, useState } from 'react'
import { Line, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { useTheme } from '../context/ThemeContext'
import styles from './ChartCard.module.css'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler)

/**
 * One chart, in a card.
 *
 * ## Colour comes from the tokens, and follows the theme
 *
 * Chart.js needs concrete colour values — it draws on a canvas, so it cannot use a CSS
 * variable. This reads the resolved value of one *at render time* instead, which keeps
 * the rule that nothing in `src/` hardcodes a colour, and means the axes, grid and
 * series all change with the theme rather than staying light-mode blue on a dark page.
 * `useTheme()` is what makes it re-read: the hook is subscribed to the toggle, so a
 * theme change re-renders this component and the values are resolved again.
 *
 * ## What a canvas cannot do
 *
 * A chart is an image to a screen reader. `role="img"` with a summary is the minimum —
 * it says what is being plotted and over what range, so somebody who cannot see it is
 * not simply told "canvas". The numbers themselves are always available elsewhere on
 * these pages, in a table, which is the honest fallback.
 */

interface ChartCardProps {
  title: string
  type: 'line' | 'bar'
  labels: string[]
  data: number[]
  /** The series name, used in the tooltip and the accessible summary. */
  label: string
  /**
   * A semantic token name for the series, without the leading dashes —
   * `primary`, `info`, `success`. Not a colour: the palette is not a caller's choice.
   */
  tone?: 'primary' | 'info' | 'success' | 'warning'
}

/** Resolves a custom property to the concrete value Chart.js needs. */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export default function ChartCard({ title, type, labels, data, label, tone = 'primary' }: ChartCardProps) {
  // Subscribed so a theme change re-renders this component; the value itself is only
  // needed as a dependency, not as a branch.
  const { theme } = useTheme()
  const [colors, setColors] = useState(() => readColors(tone))

  useEffect(() => {
    setColors(readColors(tone))
  }, [theme, tone])

  const chartData = {
    labels,
    datasets: [
      {
        label,
        data,
        borderColor: colors.series,
        backgroundColor: type === 'line' ? colors.fill : colors.series,
        fill: type === 'line',
        tension: 0.35,
        borderWidth: 2,
        pointRadius: data.length > 20 ? 0 : 3,
        borderRadius: type === 'bar' ? 6 : undefined,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: colors.tooltipBg,
        titleColor: colors.tooltipText,
        bodyColor: colors.tooltipText,
        padding: 10,
        displayColors: false,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: colors.axis,
          // A 30-point series on a 320px screen cannot show 30 labels legibly, so it
          // shows as many as fit and no more — better than a row of overlapping ink.
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 6,
        },
      },
      y: {
        grid: { color: colors.grid },
        ticks: { color: colors.axis, maxTicksLimit: 5 },
        beginAtZero: true,
      },
    },
  }

  const summary = `${title}: ${label} from ${labels[0] ?? 'the start'} to ${labels[labels.length - 1] ?? 'now'}, ${data.length} points.`

  return (
    <div className="card">
      <h3 className={styles.title}>{title}</h3>
      <div className={styles.canvas} role="img" aria-label={summary}>
        {type === 'line' ? <Line data={chartData} options={options} /> : <Bar data={chartData} options={options} />}
      </div>
    </div>
  )
}

function readColors(tone: NonNullable<ChartCardProps['tone']>) {
  const series = token(`--${tone}`, '#2f43e0')
  return {
    series,
    // A translucent version of the same token, so the fill follows the theme too.
    fill: token(`--${tone}-soft`, 'rgba(47, 67, 224, 0.16)'),
    axis: token('--text-muted', '#64748b'),
    grid: token('--border-subtle', 'rgba(148, 163, 184, 0.2)'),
    tooltipBg: token('--tooltip-bg', '#0f172a'),
    tooltipText: token('--tooltip-text', '#f8fafc'),
  }
}
