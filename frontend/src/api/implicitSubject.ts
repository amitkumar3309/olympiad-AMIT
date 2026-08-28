import { api } from './client'
import type { Subject, Topic } from './types'

/**
 * The one subject, resolved rather than chosen — the browser's half of a rule the server owns.
 *
 * ## Why this exists at all
 *
 * AMIT is a mathematics olympiad, so since Milestone 21 Phase J nobody picks a subject: there is no
 * dropdown, no column and no filter. But `Topic` is still scoped by subject on the backend, and a
 * deployment's database may well hold more than one `Subject` — a legacy Physics one, for instance.
 * So every screen that lists chapters has to answer "which subject's chapters?" without asking.
 *
 * Before this module, five screens answered it five different ways: two resolutions that disagreed
 * with each other, and four that did not scope at all and listed **every chapter of every subject**
 * in one undifferentiated list. On a screen that has deliberately stopped mentioning subjects,
 * nothing told an examiner why "Alternating Current" was sitting among the calculus — and filing a
 * question under it would quietly place that question outside the mathematics pool every student
 * practises from.
 *
 * ## It mirrors `findImplicitSubject()` exactly, including the null
 *
 * The backend rule (`services/taxonomyService.ts`) is: none → null; exactly one → that one;
 * otherwise the one *named* for mathematics, and **null if there isn't one**. That last case does
 * not fall back to the first subject, and neither does this, because a fallback here would show an
 * examiner chapters the server would then refuse to write to. Better an empty list that says why.
 *
 * Keep the two in step. If the server's rule changes, this changes with it.
 */
export function resolveImplicitSubject(subjects: Subject[]): Subject | null {
  if (subjects.length === 0) return null
  if (subjects.length === 1) return subjects[0] ?? null

  return subjects.find((subject) => /^(math|maths|mathematics)$/i.test(subject.name.trim())) ?? null
}

/** Fetches the active subjects and resolves the implicit one. */
export async function loadImplicitSubject(): Promise<Subject | null> {
  const res = await api.get<{ subjects: Subject[] }>('/subjects?status=active')
  return resolveImplicitSubject(res.subjects)
}

/**
 * The top-level chapters of the implicit subject — what every chapter picker in the product shows.
 *
 * Two round trips rather than one, and deliberately sequential: the filter *is* the subject the
 * first call resolves. An admin screen can afford it, and the alternative is the bug above.
 *
 * Returns an empty list when no subject resolves, rather than falling back to every chapter.
 */
export async function loadChapters(): Promise<Topic[]> {
  return (await loadChapterScope()).chapters
}

/**
 * The same, but also handing back **which** subject that was.
 *
 * The two admin question *pickers* — the mock-test paper builder and the daily-challenge scheduler —
 * need the id as well as the chapters, because they filter `/admin/questions` by it. That filter is
 * what stops a maths paper being built from a legacy subject's questions: the Question Bank itself
 * stays deliberately unscoped, so an administrator can still find and manage that legacy data, but
 * the two screens that decide *what a child is served* offer only the implicit subject.
 *
 * Returned together rather than fetched twice so a picker cannot end up filtering by one subject
 * while listing another's chapters.
 */
export async function loadChapterScope(): Promise<{ subjectId: string | null; chapters: Topic[] }> {
  const subject = await loadImplicitSubject()
  if (!subject) return { subjectId: null, chapters: [] }

  const res = await api.get<{ topics: Topic[] }>(
    `/topics?subject=${encodeURIComponent(subject.id)}&parent=root&status=active`,
  )
  return { subjectId: subject.id, chapters: res.topics }
}
