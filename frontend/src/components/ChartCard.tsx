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

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Tooltip, Legend, Filler)

interface ChartCardProps {
  title: string
  type: 'line' | 'bar'
  labels: string[]
  data: number[]
  label: string
  color?: string
}

export default function ChartCard({ title, type, labels, data, label, color = '#0052ff' }: ChartCardProps) {
  const chartData = {
    labels,
    datasets: [
      {
        label,
        data,
        borderColor: color,
        backgroundColor: type === 'line' ? `${color}33` : color,
        fill: type === 'line',
        tension: 0.4,
        borderRadius: type === 'bar' ? 8 : undefined,
      },
    ],
  }

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false } },
      y: { grid: { color: 'rgba(148,163,184,0.15)' } },
    },
  }

  return (
    <div className="card">
      <h3>{title}</h3>
      <div style={{ height: 260 }}>
        {type === 'line' ? <Line data={chartData} options={options} /> : <Bar data={chartData} options={options} />}
      </div>
    </div>
  )
}
