import { PRIZE_BANDS, type PrizeBandInfo, type QuizPrizeInfo } from '../api/types'
import { formatNumber } from './format'

/**
 * The prize, in words, from the owner's settings (Milestone 30) — the one place the
 * frontend turns `QuizPrizeInfo` into a sentence, so the quiz card, the Login Gate, the
 * Rewards section and the rules page cannot describe the prize differently.
 *
 * "Surprise gift + cash prize", and "(₹500)" only when the owner has set an amount:
 * no money figure is ever shown that the settings do not hold (brief §3, "never hardcode
 * money").
 */
export function prizeLine(prize: Pick<QuizPrizeInfo, 'prizeText' | 'cashAmount'>): string {
  const cash = prize.cashAmount !== null && prize.cashAmount > 0 ? ` (₹${formatNumber(prize.cashAmount)})` : ''
  return `${prize.prizeText}${cash}`
}

/**
 * The class band a class's answers count in for the monthly prize — "Classes 9–10" — or null
 * without a class. The bands are the server's (`GET /daily-quiz/info`), the mirror until then.
 */
export function bandLabelFor(classLevel: string | null | undefined, bands: PrizeBandInfo[] = PRIZE_BANDS): string | null {
  const n = classLevel ? Number(classLevel.replace(/^Class\s+/, '')) : Number.NaN
  if (!Number.isInteger(n)) return null
  return bands.find((band) => n >= band.min && n <= band.max)?.label ?? null
}

/** "Classes 3–5, 6–8, 9–10 and 11–12". */
export function bandsSentence(bands: PrizeBandInfo[] = PRIZE_BANDS): string {
  const ranges = bands.map((band) => `${band.min}–${band.max}`)
  return `Classes ${ranges.slice(0, -1).join(', ')} and ${ranges[ranges.length - 1] ?? ''}`
}
