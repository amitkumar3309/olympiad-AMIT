import { config } from '../config';
import { logger } from '../lib/logger';
import { Subject, Topic, type QuestionDocument } from '../models';
import { ApiError } from '../lib/ApiError';
import { createQuestionSchema } from '../validation/questionSchemas';
import { createQuestion, toQuestionContent } from './questionService';
import type { Actor } from './taxonomyService';
import { templateQuestionGenerator, TEMPLATE_GENERATOR_ID } from '../lib/templateQuestionGenerator';
import { geminiQuestionGenerator } from './geminiQuestionGenerator';
import type {
  GeneratedCandidate,
  GenerationRequest,
  GeneratorDescriptor,
  QuestionGenerator,
  RejectedCandidate,
} from '../lib/questionGeneratorTypes';

/**
 * THE path from "generate questions" to rows in the question bank (Milestone 17).
 *
 * A generator writes text. This decides whether that text is allowed to become a
 * question, and the division is the point: **a generator is never trusted, and the
 * trust boundary is one function.**
 *
 * ## What happens to every candidate, whoever produced it
 *
 * 1. The **taxonomy is attached here**, from the administrator's validated request.
 *    A candidate has no subject, topic, class or difficulty field to supply, so a model
 *    cannot file a question anywhere it was not asked to.
 * 2. It is parsed by **`createQuestionSchema`** — the same schema a hand-authored
 *    question passes, which runs `validateMathContent()` on the text, the options and
 *    the solution, and enforces the per-type answer rules. There is no model-specific
 *    validator, deliberately: two validators would eventually disagree and the
 *    model-facing one would be the weaker.
 * 3. A failure is **rejected and reported with its reason**, never repaired. Silently
 *    fixing a model's output is how a plausible-looking wrong answer key gets stored.
 * 4. What survives is written by **`createQuestion()`**, which has exactly one status:
 *    `draft`. Publishing stays a separate, deliberate, human act on each question.
 *
 * That chain is why an AI generator is a safe feature rather than a risky one. The
 * worst a bad model can do is waste a reviewer's time.
 *
 * ## Fallback, not failure
 *
 * If the configured generator is unavailable (no key) or throws (quota, timeout,
 * unusable output), the template generator runs instead and the response says so. An
 * examiner who wanted five drafts gets five blank ones they can type into, which beats
 * an error message.
 */

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const generators = new Map<string, QuestionGenerator>([
  [templateQuestionGenerator.descriptor.id, templateQuestionGenerator],
  [geminiQuestionGenerator.descriptor.id, geminiQuestionGenerator],
]);

/** Adds a generator so `QUESTION_GENERATOR` can select it. */
export function registerQuestionGenerator(generator: QuestionGenerator): void {
  generators.set(generator.descriptor.id, generator);
}

export function listQuestionGenerators(): QuestionGenerator[] {
  return [...generators.values()];
}

/**
 * The generator to try first.
 *
 * `auto` — the default — means "a model if one is configured, otherwise templates",
 * which is what makes adding a `GEMINI_API_KEY` the *only* step needed to turn the
 * feature on, and removing it the only step needed to turn it off.
 */
export function resolveQuestionGenerator(id: string = config.ai.questionGenerator): QuestionGenerator {
  if (id === 'auto') {
    const model = [...generators.values()].find(
      (generator) => generator.descriptor.kind === 'model' && generator.isAvailable(),
    );
    return model ?? templateQuestionGenerator;
  }

  const chosen = generators.get(id);
  if (!chosen) {
    logger.warn({ requested: id, available: [...generators.keys()] }, 'QUESTION_GENERATOR names an unknown generator');
    return templateQuestionGenerator;
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// The outcome
// ---------------------------------------------------------------------------

export interface GenerationOutcome {
  /** Which generator actually produced the drafts — written here, never by the generator. */
  generator: GeneratorDescriptor;
  created: QuestionDocument[];
  /** Candidates that failed validation, with the reason. Reported, never hidden. */
  rejected: RejectedCandidate[];
  requested: number;
  /** Machine-readable facts about what happened, e.g. why a fallback was used. */
  notes: string[];
}

export interface GenerateInput {
  subject: string;
  topic: string;
  classLevel: GenerationRequest['classLevel'];
  difficulty: GenerationRequest['difficulty'];
  count: number;
  instructions: string | null;
}

/** Turns a zod failure into one sentence an examiner can act on. */
function reasonFrom(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: Array<string | number>; message: string }> }).issues;
    return issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join('.') || 'question'}: ${issue.message}`)
      .join('; ');
  }
  return error instanceof Error ? error.message : 'Unusable question.';
}

// ---------------------------------------------------------------------------
// The one entry point
// ---------------------------------------------------------------------------

export async function generateQuestionDrafts(input: GenerateInput, actor: Actor): Promise<GenerationOutcome> {
  // Names for the prompt, and existence checks that must happen before anything is
  // sent anywhere. `createQuestion()` re-resolves the taxonomy itself and is the real
  // guard; this read is what lets a generator be given words instead of ids.
  const [subject, topic] = await Promise.all([
    Subject.findById(input.subject).select('name'),
    Topic.findById(input.topic).select('name subject'),
  ]);

  if (!subject) throw ApiError.badRequest('That subject does not exist.');
  if (!topic) throw ApiError.badRequest('That topic does not exist.');

  const request: GenerationRequest = {
    subjectName: subject.name,
    topicName: topic.name,
    classLevel: input.classLevel,
    difficulty: input.difficulty,
    count: input.count,
    instructions: input.instructions,
  };

  const notes: string[] = [];
  let generator = resolveQuestionGenerator();
  let candidates: GeneratedCandidate[];

  if (!generator.isAvailable()) {
    notes.push(`generator-unavailable:${generator.descriptor.id}`);
    generator = templateQuestionGenerator;
  }

  try {
    candidates = await generator.generate(request);
  } catch (err) {
    // The provider's own message is kept, because "it failed" is not actionable: an
    // expired key, a spent quota and a blocked prompt need three different fixes.
    const detail = err instanceof Error ? err.message : 'The generator failed.';
    logger.error({ err, generator: generator.descriptor.id }, 'Question generator failed — falling back to templates');
    notes.push(`generator-failed:${detail}`);
    generator = templateQuestionGenerator;
    candidates = await templateQuestionGenerator.generate(request);
  }

  if (candidates.length === 0) {
    notes.push('generator-returned-nothing');
    generator = templateQuestionGenerator;
    candidates = await templateQuestionGenerator.generate(request);
  }

  // A generator that ignores the count must not be able to flood the bank. The cap is
  // the administrator's own request, already validated at 1-20.
  if (candidates.length > input.count) {
    notes.push(`generator-returned-extra:${candidates.length}`);
    candidates = candidates.slice(0, input.count);
  }

  const created: QuestionDocument[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const [index, candidate] of candidates.entries()) {
    // The taxonomy is attached HERE, from the request — never taken from the
    // candidate, which has no field to carry it.
    const parsed = createQuestionSchema.safeParse({
      ...candidate,
      subject: input.subject,
      topic: input.topic,
      subtopic: null,
      classLevel: input.classLevel,
      difficulty: input.difficulty,
    });

    if (!parsed.success) {
      rejected.push({ index: index + 1, reason: reasonFrom(parsed.error) });
      continue;
    }

    try {
      // Through the same normalisation the admin editor uses — server-assigned option
      // keys included — and always a draft: `createQuestion()` has no other mode.
      created.push(await createQuestion(toQuestionContent(parsed.data), actor));
    } catch (err) {
      rejected.push({ index: index + 1, reason: err instanceof Error ? err.message : 'Could not be saved.' });
    }
  }

  if (created.length === 0 && rejected.length > 0) notes.push('every-candidate-was-rejected');

  return { generator: generator.descriptor, created, rejected, requested: input.count, notes };
}

export { TEMPLATE_GENERATOR_ID };
