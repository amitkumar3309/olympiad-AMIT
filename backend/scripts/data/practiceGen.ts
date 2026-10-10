import { rngFor, type Template } from '../../src/lib/mathTemplates/engine';
import { sc, type SeedSubject } from './seedTypes';

/**
 * Turns a class's templates into its practice bank (2026-10-10). The templates and the
 * machinery live in `src/lib/mathTemplates/`, shared with the automatic Daily Quiz.
 */

/**
 * Builds a class's bank from its templates. Throws — so the seed and its test fail loudly — when a
 * template cannot produce its count of distinct questions, or cannot find three wrong options.
 */
export function buildBank(classLevel: string, templates: Template[]): SeedSubject {
  const rng = rngFor(`amit-practice:${classLevel}`);
  const seen = new Set<string>();
  const byTopic = new Map<string, ReturnType<typeof sc>[]>();

  templates.forEach((template, index) => {
    let made = 0;
    let attempts = 0;
    while (made < template.count) {
      attempts += 1;
      if (attempts > template.count * 200) {
        throw new Error(`${classLevel}, template ${index + 1} (${template.topic}): only ${made} of ${template.count} distinct questions`);
      }
      const draft = template.make(rng);
      if (seen.has(draft.q)) continue;
      const wrong: string[] = [];
      for (const option of draft.wrong) {
        if (option !== draft.a && !wrong.includes(option)) wrong.push(option);
        if (wrong.length === 3) break;
      }
      if (wrong.length < 3) continue;
      seen.add(draft.q);
      const list = byTopic.get(template.topic) ?? [];
      list.push(
        sc(draft.q, draft.a, wrong, draft.s, {
          d: template.d,
          tags: [template.topic.toLowerCase(), 'practice'],
        }),
      );
      byTopic.set(template.topic, list);
      made += 1;
    }
  });

  return {
    subject: 'Mathematics',
    topics: [...byTopic.entries()].map(([topic, questions]) => ({ topic, questions })),
  };
}
