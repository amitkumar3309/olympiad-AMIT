import type { GeneratedCandidate, GenerationRequest, QuestionGenerator } from './questionGeneratorTypes';

/**
 * The original "AI Question Generator", which was never AI.
 *
 * It fills a template string. That is all it has ever done, and it is kept for two
 * real reasons rather than out of sentiment:
 *
 *  - **It is the fallback.** With no `GEMINI_API_KEY` configured — which is the
 *    supported default — this is what runs, so the button works out of the box and the
 *    product needs no paid service to be complete.
 *  - **It cannot fail.** When a model is configured but its quota is spent, its network
 *    is down or its output is unusable, the service falls back here rather than
 *    answering with an error, because a blank draft an administrator can type into is
 *    more useful than a stack trace.
 *
 * It is honest about itself: `kind: 'template'`, and the page says "no question content
 * is generated for you". Milestone 15 deleted a different feature for calling string
 * assembly AI, and this one keeps its correct name.
 */

export const TEMPLATE_GENERATOR_ID = 'template-v1';

export const templateQuestionGenerator: QuestionGenerator = {
  descriptor: {
    id: TEMPLATE_GENERATOR_ID,
    label: 'Blank templates',
    kind: 'template',
    basis:
      'Blank draft questions with the subject, topic, class and difficulty filled in. ' +
      'No question content is written for you — this is a form filler, not AI.',
  },

  isAvailable() {
    // No configuration, no network, no quota. It is always available, which is exactly
    // why it is the fallback.
    return true;
  },

  generate(request: GenerationRequest): Promise<GeneratedCandidate[]> {
    const candidates: GeneratedCandidate[] = Array.from({ length: request.count }, (_, index) => ({
      questionText:
        `[Template draft ${index + 1}] Replace this text with a real ${request.difficulty.toLowerCase()} ` +
        `question on ${request.topicName} for ${request.classLevel}. ` +
        `Example expression: $x^2 + ${index + 1}x + 1 = 0$`,
      type: 'single_choice',
      options: [
        { text: 'Replace with option A', isCorrect: true },
        { text: 'Replace with option B', isCorrect: false },
        { text: 'Replace with option C', isCorrect: false },
        { text: 'Replace with option D', isCorrect: false },
      ],
      booleanAnswer: null,
      numericAnswer: null,
      tolerance: null,
      solution: null,
      marks: 4,
      negativeMarks: 1,
      tags: ['template-draft'],
    }));

    return Promise.resolve(candidates);
  },
};
