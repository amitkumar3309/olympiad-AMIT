import type { QuizPrizeInfo } from '../api/types'
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
