import { z } from 'zod';
import { MAX_QUESTION_IMAGE_BYTES, QUESTION_IMAGE_KEY } from '../models/QuestionImage';
import { imageDataUrl } from './imageSchemas';

/** `POST /admin/question-images` — one picture, as a data URL, like every upload here. */
export const uploadQuestionImageSchema = z.object({
  image: imageDataUrl(MAX_QUESTION_IMAGE_BYTES, 'picture'),
});

/** `GET /question-images/:key`. */
export const questionImageKeyParamSchema = z.object({
  key: z.string().regex(QUESTION_IMAGE_KEY, 'That is not the address of a picture'),
});

/** Every control character, tab and newline included: a description is one line. */
// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL_CHARACTERS = /[\x00-\x1F\x7F-\x9F]/;

/**
 * What a screen reader says instead of a picture. Plain text — it becomes an attribute, never
 * markup — one line, and no control characters.
 */
const pictureDescription = (label: string, min: number) =>
  z
    .string()
    .trim()
    .min(min, `${label} is required — say in one line what the picture shows`)
    .max(300, `${label} must be at most 300 characters`)
    .refine((value) => !CONTROL_CHARACTERS.test(value), `${label} must be a single line of plain text`);

const pictureKey = z.string().regex(QUESTION_IMAGE_KEY, 'That picture is not one this site stored. Upload it again.');

/**
 * The question as a picture (Milestone 30 Phase 7b). Its description is **required**: for a
 * student who cannot see it, the description is the question. The size is never taken from the
 * request — the service reads it from the stored picture.
 */
export const questionPictureSchema = z.object({
  key: pictureKey,
  alt: pictureDescription('A description of the question picture', 1),
});

/** The worked solution as a picture; its description is optional (the solution's place says what it is). */
export const solutionPictureSchema = z.object({
  key: pictureKey,
  alt: pictureDescription('A description of the solution picture', 0).default(''),
});
