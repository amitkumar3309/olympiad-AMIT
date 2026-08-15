import type { Types } from 'mongoose';
import { MockTest } from '../models';
import { config } from '../config';
import { logger } from '../lib/logger';
import type { ClassLevel } from '../lib/classLevels';
import { MIN_AREA_SAMPLE, getStudentAnalytics } from './analyticsService';
import { getPracticeAvailability } from './practiceService';
import { statisticalEngine, STATISTICAL_ENGINE_ID } from '../lib/statisticalRecommender';
import type {
  RecommendationDraft,
  RecommendationEngine,
  RecommendationFacts,
  RecommendationSet,
} from '../lib/recommendationTypes';

/**
 * THE recommendation service (Milestone 16) — the only path to a recommendation.
 *
 * It does three things and deliberately no more:
 *
 *  1. **Assembles the facts.** One place queries, so an engine cannot, which is the same
 *     wall `rewardService.ts` puts between `grantReward()` and the three catalogues. An
 *     engine that could query could invent a figure no collection can produce, and could
 *     make a page slow in a way nobody budgeted for.
 *  2. **Resolves and runs the configured engine**, falling back rather than failing.
 *  3. **Stamps the provenance itself**, so an engine cannot misdescribe what produced
 *     its output.
 *
 * ## Nothing is stored
 *
 * There is no `Recommendation` collection, for the same reason there is no
 * `StudentAnalytics` one: a stored recommendation is a claim that outlives the evidence
 * behind it, and this product has already deleted one model for exactly that. A
 * recommendation is a view of the record as it stands when it is asked for.
 *
 * ## Why this is its own endpoint rather than part of the analytics payload
 *
 * The seam exists so a model-backed engine can be dropped in, and a model has latency
 * the arithmetic does not. Keeping them separate means the analytics page renders its
 * numbers as soon as they arrive and fills the advice panel when it is ready — a slow
 * engine degrades one panel instead of the page. Every recommendation carries its own
 * `basis` counts, so it states its own evidence rather than depending on the other
 * response to agree with it.
 */

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const engines = new Map<string, RecommendationEngine>([[statisticalEngine.descriptor.id, statisticalEngine]]);

/**
 * Adds an engine so `RECOMMENDATION_ENGINE` can select it.
 *
 * Call it at module load from wherever the engine lives (an import in `app.ts` is the
 * obvious place, so the serverless entry gets it too — `server.ts` never runs there).
 * Re-registering the same id replaces it, which is what a test wants and what a
 * hot-reloading dev server does anyway.
 */
export function registerRecommendationEngine(engine: RecommendationEngine): void {
  engines.set(engine.descriptor.id, engine);
}

/** Every engine this build can be pointed at. Useful for a startup log and for tests. */
export function listRecommendationEngines(): RecommendationEngine[] {
  return [...engines.values()];
}

/** Test seam: forget everything but the default. Never called by the product. */
export function resetRecommendationEngines(): void {
  engines.clear();
  engines.set(statisticalEngine.descriptor.id, statisticalEngine);
}

let warnedAboutUnknownEngine = false;

/**
 * The engine named by configuration, or the default.
 *
 * An unknown id is a misconfiguration, not a request failure: it logs once and falls
 * back. Refusing to answer would take the panel down over a typo in an environment
 * variable, and silently logging every request would drown the log that says so.
 */
export function resolveRecommendationEngine(id: string = config.recommendations.engineId): RecommendationEngine {
  const engine = engines.get(id);
  if (engine) return engine;

  if (!warnedAboutUnknownEngine) {
    warnedAboutUnknownEngine = true;
    logger.warn(
      { requested: id, available: [...engines.keys()] },
      'RECOMMENDATION_ENGINE names an engine that is not registered — using the statistical engine instead.',
    );
  }
  return statisticalEngine;
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/**
 * Assembles everything an engine is allowed to see.
 *
 * Three reads on top of the analytics derivation's own eight, all parallel: the
 * student's performance, the published bank for their class, and how many mock tests
 * are set for it. The bank is what keeps a recommendation honourable — advice to
 * practise a topic with no published questions is advice the product cannot carry out.
 */
export async function buildRecommendationFacts(
  student: Types.ObjectId,
  classLevel: ClassLevel | null,
  now = new Date(),
): Promise<RecommendationFacts> {
  const [analytics, availability, publishedMockTests] = await Promise.all([
    getStudentAnalytics(student),
    // A staff account has no class, so there is no bank to offer it.
    classLevel ? getPracticeAvailability(classLevel) : Promise.resolve([]),
    classLevel ? MockTest.countDocuments({ classLevel, status: 'published' }) : Promise.resolve(0),
  ]);

  return { classLevel, analytics, availability, publishedMockTests, now };
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

/** An engine that throws must not take the page down with it. */
function emptyDraft(note: string): RecommendationDraft {
  return { weakTopics: [], strongTopics: [], difficulty: [], practice: [], insights: [], notes: [note] };
}

export async function getRecommendations(
  student: Types.ObjectId,
  classLevel: ClassLevel | null,
  now = new Date(),
): Promise<RecommendationSet> {
  const facts = await buildRecommendationFacts(student, classLevel, now);
  const engine = resolveRecommendationEngine();

  let draft: RecommendationDraft;
  let usedEngine = engine;

  try {
    draft = await engine.recommend(facts);
  } catch (err) {
    // A model-backed engine will fail sometimes — a quota, a timeout, a malformed
    // response. Losing the advice panel is a smaller harm than losing the page, and
    // falling back to arithmetic that cannot fail is better than showing nothing.
    logger.error({ err, engine: engine.descriptor.id }, 'Recommendation engine failed — falling back to the statistical engine');
    usedEngine = statisticalEngine;
    try {
      draft = await statisticalEngine.recommend(facts);
    } catch (fallbackErr) {
      logger.error({ err: fallbackErr }, 'The statistical recommendation engine itself failed');
      draft = emptyDraft('recommendations-unavailable');
    }
  }

  return {
    ...draft,
    // Written here, from the engine that was actually invoked — never from the draft.
    // An engine therefore cannot claim to be a model, cannot backdate itself, and
    // cannot report data the student does not have.
    generatedAt: now,
    engine: usedEngine.descriptor,
    hasData: facts.analytics.hasData,
    minimumSample: MIN_AREA_SAMPLE,
  };
}

export { STATISTICAL_ENGINE_ID };
