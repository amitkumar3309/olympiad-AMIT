/**
 * Checks that the backend can reach Google Gemini, without touching the database and
 * without spending generation quota.
 *
 *   npm run verify:gemini --prefix backend
 *
 * It asks the configured key which models it may use. That is a free metadata call, and it
 * is the only check that distinguishes the three things that look identical from the admin
 * page — "no key", "a key Google refuses" and "a key that works but names a retired model".
 *
 * Deliberately **read-only**: it never calls `generateContent`, so running it costs nothing
 * and cannot create a question. It therefore needs no `assertConfiguredForWrites()` — that
 * guard exists for scripts that write, and this one has no write path to guard.
 *
 * The key is masked in all output, exactly as `verify-email.ts` masks the SMTP password.
 */
import { config } from '../src/config';
import { listAvailableModels } from '../src/services/geminiQuestionGenerator';

function mask(value: string | undefined): string {
  if (!value) return '(not set)';
  if (value.length <= 6) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}${'*'.repeat(Math.min(12, value.length - 6))}${value.slice(-3)}`;
}

async function main(): Promise<void> {
  console.log('\n--- Gemini configuration ---');
  console.log(`  GEMINI_API_KEY    : ${mask(config.ai.geminiApiKey)}`);
  console.log(`  GEMINI_MODEL      : ${config.ai.geminiModel}`);
  console.log(`  QUESTION_GENERATOR: ${config.ai.questionGenerator}`);
  console.log(`  GEMINI_MAX_RETRIES: ${config.ai.geminiMaxRetries}`);

  if (!config.ai.geminiApiKey) {
    console.log('\nRESULT: no key configured.');
    console.log('AI question drafting is off. Every other feature works normally.');
    console.log('Add GEMINI_API_KEY to backend/.env and restart — see ENVIRONMENT_VARIABLES.md.');
    process.exitCode = 1;
    return;
  }

  console.log('\nAsking Google which models this key may use (free, no generation)…');

  let models;
  try {
    models = await listAvailableModels();
  } catch (err) {
    console.log(`\nRESULT: Google refused. ${err instanceof Error ? err.message : String(err)}`);
    console.log('An invalid key, a blocked project and no internet each say something different above.');
    process.exitCode = 1;
    return;
  }

  if (models.length === 0) {
    console.log('\nRESULT: the key works, but no model on it can answer generateContent.');
    process.exitCode = 1;
    return;
  }

  console.log(`\n${models.length} model(s) available:`);
  for (const model of models) {
    console.log(`  ${model.inUse ? '->' : '  '} ${model.id}`);
  }

  const configured = models.some((model) => model.inUse);
  if (configured) {
    console.log(`\nRESULT: OK. GEMINI_MODEL (${config.ai.geminiModel}) is one your key can call.`);
    return;
  }

  // The failure that arrives on Google's schedule rather than ours, and the one whose remedy
  // is not guessable from the generation error it eventually causes.
  console.log(`\nRESULT: the key works, but GEMINI_MODEL (${config.ai.geminiModel}) is NOT in the list above.`);
  console.log('Generation will fail with "this model is no longer available".');
  console.log('Set GEMINI_MODEL to one of the names listed, or leave it as a rolling alias.');
  process.exitCode = 1;
}

void main();
