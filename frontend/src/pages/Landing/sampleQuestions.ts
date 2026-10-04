/**
 * The homepage's "Can you crack this?" questions (Milestone 30, Phase 3 — brief §7.1 #4).
 *
 * ## Every answer is checked by a script, not by eye
 *
 * `scripts/verify-sample-questions.ts` recomputes each answer independently — by
 * arithmetic, by brute force over every arrangement, by searching every sequence of
 * moves — and fails if the marked option is not the one, and only one, that is right.
 * Run it with `npm run verify:samples` after any edit here. The mockup's own sample
 * question had **no** correct option (brief, Appendix B); that is the failure this
 * exists to make impossible.
 *
 * ## Nothing reaches the homepage until a person has read it
 *
 * `reviewed: true` means the owner has approved the question for the public page. The
 * Mathematics set was part of the approved plan (PLAN.md Q8); Logic, Reasoning and
 * Brainstorming were **drafted by Claude for the owner's review** (owner, 2026-10-04:
 * "I draft, you review") and stay `false` until the owner says otherwise. A tab is shown
 * only when it has at least `MIN_PER_TAB` reviewed questions, so flipping the flags is
 * the whole of publishing a tab. `docs/launch/SAMPLE_QUESTIONS.md` is the review sheet,
 * generated from this file (`npm run verify:samples -- --markdown`).
 *
 * ## Writing one
 *
 * Plain text with `$...$` maths, rendered by `MathText`. Exactly four options. The
 * explanation is one or two short sentences a Class 6 student can follow, and it states
 * the answer's *value*, never its letter — option order is not part of the answer.
 */

export type SampleCategory = 'mathematics' | 'logic' | 'reasoning' | 'brainstorming'

export interface SampleQuestion {
  /** Stable; the verifier keys its independent check on it. */
  id: string
  category: SampleCategory
  question: string
  options: readonly [string, string, string, string]
  /** Index into `options`. */
  answer: 0 | 1 | 2 | 3
  explanation: string
  /** Approved by the owner for the public homepage. */
  reviewed: boolean
}

/** A tab needs this many reviewed questions before it appears (brief: "≥5 verified"). */
export const MIN_PER_TAB = 5

export const SAMPLE_CATEGORIES: ReadonlyArray<{ id: SampleCategory; label: string }> = [
  { id: 'mathematics', label: 'Mathematics' },
  { id: 'logic', label: 'Logic' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'brainstorming', label: 'Brainstorming' },
]

export const SAMPLE_QUESTIONS: readonly SampleQuestion[] = [
  // ---------------------------------------------------------------- Mathematics
  {
    // The mockup's question, with options that include the real answer (Appendix B).
    id: 'math-power-sum',
    category: 'mathematics',
    question: 'If $x$ is a positive real number such that $x + \\frac{1}{x} = 3$, what is the value of $\\dfrac{x^5 + x^{-5}}{x^2 + x^{-2}}$?',
    options: ['$\\frac{115}{7}$', '$\\frac{119}{7}$', '$\\frac{123}{7}$', '$\\frac{127}{7}$'],
    answer: 2,
    explanation: 'Squaring and cubing give $x^2 + x^{-2} = 7$ and $x^3 + x^{-3} = 18$, so $x^5 + x^{-5} = 7 \\times 18 - 3 = 123$.',
    reviewed: true,
  },
  {
    id: 'math-odd-sum',
    category: 'mathematics',
    question: 'What is the sum of the first 20 odd numbers, $1 + 3 + 5 + \\dots$?',
    options: ['200', '210', '400', '420'],
    answer: 2,
    explanation: 'The first $n$ odd numbers always add up to $n^2$, and $20^2 = 400$.',
    reviewed: true,
  },
  {
    id: 'math-divisors',
    category: 'mathematics',
    question: 'How many positive whole numbers divide 360 exactly?',
    options: ['20', '24', '30', '36'],
    answer: 1,
    explanation: '$360 = 2^3 \\times 3^2 \\times 5$, so it has $(3+1)(2+1)(1+1) = 24$ divisors.',
    reviewed: true,
  },
  {
    id: 'math-area-change',
    category: 'mathematics',
    question: 'The length of a rectangle is increased by 20% and its width is decreased by 20%. What happens to its area?',
    options: ['It stays the same', 'It decreases by 4%', 'It increases by 4%', 'It decreases by 20%'],
    answer: 1,
    explanation: 'The new area is $1.2 \\times 0.8 = 0.96$ times the old one — 4% smaller.',
    reviewed: true,
  },
  {
    id: 'math-last-digit',
    category: 'mathematics',
    question: 'What is the last digit of $7^{2026}$?',
    options: ['1', '3', '7', '9'],
    answer: 3,
    explanation: 'Powers of 7 end in 7, 9, 3, 1 and then repeat. $2026$ leaves remainder 2 when divided by 4, so it ends like $7^2 = 49$.',
    reviewed: true,
  },
  {
    id: 'math-average',
    category: 'mathematics',
    question: 'The average of five numbers is 12. One number is removed, and the average of the other four is 10. Which number was removed?',
    options: ['2', '20', '22', '40'],
    answer: 1,
    explanation: 'The five add up to $5 \\times 12 = 60$ and the four to $4 \\times 10 = 40$, so the removed number is $20$.',
    reviewed: true,
  },
  {
    id: 'math-marbles',
    category: 'mathematics',
    question: 'Riya has three times as many marbles as Aman. Together they have 48. How many marbles does Riya have?',
    options: ['12', '16', '32', '36'],
    answer: 3,
    explanation: 'Aman has one share and Riya three. Four shares make 48, so one share is 12 and Riya has 36.',
    reviewed: true,
  },

  // ---------------------------------------------------------------------- Logic
  {
    id: 'logic-syllogism',
    category: 'logic',
    question: 'All bloops are razzies, and all razzies are lazzies. Which statement must be true?',
    options: ['All lazzies are bloops', 'All bloops are lazzies', 'Some razzies are not bloops', 'No lazzie is a bloop'],
    answer: 1,
    explanation: 'Every bloop is a razzie and every razzie is a lazzie, so every bloop is a lazzie. The other three could be true, but need not be.',
    reviewed: false,
  },
  {
    id: 'logic-knights',
    category: 'logic',
    question: 'On an island, knights always tell the truth and knaves always lie. A says: “B is a knave.” B says: “A and I are the same type.” What are A and B?',
    options: ['Both are knights', 'A is a knight, B is a knave', 'A is a knave, B is a knight', 'Both are knaves'],
    answer: 1,
    explanation: 'If A were a knave, B would be a knight — but then B’s statement would be false. So A tells the truth: A is a knight and B is a knave.',
    reviewed: false,
  },
  {
    id: 'logic-boxes',
    category: 'logic',
    question: 'Three boxes are labelled Apples, Oranges and Mixed, and every label is wrong. You may take one fruit from one box without looking inside. Which box lets you relabel all three correctly?',
    options: ['The box labelled Apples', 'The box labelled Oranges', 'The box labelled Mixed', 'No single fruit is enough'],
    answer: 2,
    explanation: 'The box labelled Mixed holds only one kind of fruit, so the fruit you draw names it — and then the other two boxes can only be one way round.',
    reviewed: false,
  },
  {
    id: 'logic-rain',
    category: 'logic',
    question: '“If it rains, the match is cancelled.” The match was not cancelled. What follows?',
    options: ['It rained', 'It did not rain', 'It rained, but the match went ahead', 'Nothing can be concluded'],
    answer: 1,
    explanation: 'Rain would have cancelled the match. The match was not cancelled, so it cannot have rained.',
    reviewed: false,
  },
  {
    id: 'logic-heights',
    category: 'logic',
    question: 'Asha is taller than Bina. Chetan is shorter than Bina. Dev is taller than Asha. Who is the shortest?',
    options: ['Asha', 'Bina', 'Chetan', 'Dev'],
    answer: 2,
    explanation: 'From tallest to shortest the order is Dev, Asha, Bina, Chetan.',
    reviewed: false,
  },
  {
    id: 'logic-one-true',
    category: 'logic',
    question: 'Exactly one of these is true. (1) The prize is in box 1. (2) The prize is not in box 2. (3) The prize is not in box 1. Where is the prize?',
    options: ['Box 1', 'Box 2', 'Box 3', 'It cannot be decided'],
    answer: 1,
    explanation: 'Box 1 would make statements 1 and 2 true; box 3 would make 2 and 3 true. Only box 2 leaves exactly one true statement.',
    reviewed: false,
  },

  // ------------------------------------------------------------------ Reasoning
  {
    id: 'reasoning-series',
    category: 'reasoning',
    question: 'What comes next? $2,\\ 6,\\ 12,\\ 20,\\ 30,\\ \\_\\_$',
    options: ['36', '40', '42', '48'],
    answer: 2,
    explanation: 'The gaps grow by 2 each time — 4, 6, 8, 10 — so the next gap is 12 and $30 + 12 = 42$.',
    reviewed: false,
  },
  {
    id: 'reasoning-code',
    category: 'reasoning',
    question: 'If CAT is written as DBU, how is DOG written?',
    options: ['DPH', 'EOG', 'EPH', 'FQI'],
    answer: 2,
    explanation: 'Each letter moves one place forward in the alphabet: D becomes E, O becomes P and G becomes H.',
    reviewed: false,
  },
  {
    id: 'reasoning-odd-one',
    category: 'reasoning',
    question: 'Which number does not belong with the others: 144, 169, 196, 210?',
    options: ['144', '169', '196', '210'],
    answer: 3,
    explanation: '144, 169 and 196 are perfect squares — $12^2$, $13^2$ and $14^2$. 210 is not.',
    reviewed: false,
  },
  {
    id: 'reasoning-directions',
    category: 'reasoning',
    question: 'Ravi walks 4 km north, turns right and walks 3 km, then turns right again and walks 4 km. How far is he from where he started?',
    options: ['3 km', '4 km', '5 km', '7 km'],
    answer: 0,
    explanation: 'The 4 km north and the 4 km back south cancel out, leaving only the 3 km he walked east.',
    reviewed: false,
  },
  {
    id: 'reasoning-calendar',
    category: 'reasoning',
    question: '1 January 2026 is a Thursday. What day of the week is 1 March 2026?',
    options: ['Saturday', 'Sunday', 'Monday', 'Tuesday'],
    answer: 1,
    explanation: 'January has 31 days and February 2026 has 28: 59 days in all. $59 = 8 \\times 7 + 3$, so it is three days after Thursday.',
    reviewed: false,
  },
  {
    id: 'reasoning-pattern',
    category: 'reasoning',
    question: 'In a pattern, $3 \\star 4 = 25$ and $5 \\star 12 = 169$. What is $6 \\star 8$?',
    options: ['14', '48', '100', '196'],
    answer: 2,
    explanation: 'The rule is $a \\star b = a^2 + b^2$, so $6 \\star 8 = 36 + 64 = 100$.',
    reviewed: false,
  },

  // -------------------------------------------------------------- Brainstorming
  {
    id: 'brain-chess-squares',
    category: 'brainstorming',
    question: 'How many squares of every size are there on an 8 × 8 chessboard?',
    options: ['64', '120', '204', '256'],
    answer: 2,
    explanation: 'There are $8^2$ small squares, $7^2$ of size 2 × 2, and so on down to one 8 × 8: $64 + 49 + 36 + 25 + 16 + 9 + 4 + 1 = 204$.',
    reviewed: false,
  },
  {
    id: 'brain-jugs',
    category: 'brainstorming',
    question: 'You have a 3-litre jug, a 5-litre jug and plenty of water. Filling a jug, emptying a jug, or pouring one into the other is one step each. What is the fewest steps to get exactly 4 litres in the 5-litre jug?',
    options: ['4', '5', '6', '8'],
    answer: 2,
    explanation: 'Fill the 5, pour into the 3, empty the 3, pour the 2 litres across, fill the 5 again, then top up the 3 — leaving 4 litres. No shorter sequence works.',
    reviewed: false,
  },
  {
    id: 'brain-sevens',
    category: 'brainstorming',
    question: 'How many times do you write the digit 7 when you write every number from 1 to 100?',
    options: ['10', '11', '19', '20'],
    answer: 3,
    explanation: 'Ten times in the units place (7, 17, …, 97) and ten times in the tens place (70 to 79) — 77 has one of each.',
    reviewed: false,
  },
  {
    id: 'brain-snail',
    category: 'brainstorming',
    question: 'A snail at the bottom of a 10 m well climbs 3 m every day and slips back 2 m every night. On which day does it reach the top?',
    options: ['Day 7', 'Day 8', 'Day 9', 'Day 10'],
    answer: 1,
    explanation: 'After seven days and nights it is 7 m up. On day 8 it climbs the last 3 m and is out before night comes.',
    reviewed: false,
  },
  {
    id: 'brain-cake',
    category: 'brainstorming',
    question: 'What is the fewest straight cuts that can divide a round cake into 8 equal pieces, if the pieces are not moved between cuts?',
    options: ['3', '4', '7', '8'],
    answer: 0,
    explanation: 'Two cuts across the top make 4 pieces, and one cut through the middle, parallel to the plate, doubles them to 8. Two cuts can never make more than 4.',
    reviewed: false,
  },
  {
    id: 'brain-handshakes',
    category: 'brainstorming',
    question: 'Ten people meet, and each shakes hands once with every other person. How many handshakes are there?',
    options: ['20', '45', '90', '100'],
    answer: 1,
    explanation: 'Each of the 10 shakes 9 hands, but that counts every handshake twice: $10 \\times 9 \\div 2 = 45$.',
    reviewed: false,
  },
]

/** The questions a tab may show: reviewed ones only. */
export function publishedQuestions(category: SampleCategory): SampleQuestion[] {
  return SAMPLE_QUESTIONS.filter((q) => q.category === category && q.reviewed)
}

/** The tabs with enough reviewed questions to appear. */
export function publishedCategories(): Array<{ id: SampleCategory; label: string }> {
  return SAMPLE_CATEGORIES.filter((c) => publishedQuestions(c.id).length >= MIN_PER_TAB)
}
