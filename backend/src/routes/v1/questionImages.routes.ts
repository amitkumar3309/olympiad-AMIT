import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { pictureUploadLimiter } from '../../middleware/rateLimiter';
import { sendError, sendSuccess } from '../../lib/apiResponse';
import { logger } from '../../lib/logger';
import { respondToServiceError } from '../../lib/serviceError';
import {
  readQuestionImage,
  storeQuestionImage,
  sweepUnusedQuestionImagesNowAndThen,
} from '../../services/questionImageService';
import { questionImageKeyParamSchema, uploadQuestionImageSchema } from '../../validation/questionImageSchemas';
import type { DecodedImage } from '../../validation/imageSchemas';

/**
 * A question's pictures (Milestone 30 Phase 7b — picture questions).
 *
 *  - `POST /admin/question-images`  store one picture; answers its key, address and size
 *  - `GET  /question-images/:key`   the picture's bytes
 *
 * Uploading writes no question: a picture is attached when the question that names its key is
 * saved, and one nothing names is removed later (`sweepUnusedQuestionImages()`).
 */
const router = Router();

router.post(
  '/admin/question-images',
  // Ahead of the permission check, as `importLimiter` is: the cheapest refusal comes first.
  pictureUploadLimiter,
  requirePermission('questions:write'),
  validate({ body: uploadQuestionImageSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { image } = req.body as { image: DecodedImage };
      const stored = await storeQuestionImage(image, req.user?.sub ?? null);
      // Uploading is what leaves pictures behind, so it is also what clears them (at most hourly).
      await sweepUnusedQuestionImagesNowAndThen();
      sendSuccess(res, 201, { image: stored });
    } catch (err) {
      respondToServiceError(res, err, {
        log: 'Failed to store a question picture',
        fallback: 'Could not save that picture. Please try again.',
      });
    }
  },
);

/**
 * The bytes of one picture.
 *
 * No session is checked: the key is the permission. It is 128 random bits, and it reaches a
 * browser only inside a view allowed to show that picture — a solution picture's key only where
 * its solution may be shown. A picture never changes (`models/QuestionImage.ts`), so it may be
 * cached anywhere for a year: a browser asks once, and a shared cache spares the database.
 */
router.get(
  '/question-images/:key',
  validate({ params: questionImageKeyParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const image = await readQuestionImage(String(req.params.key));
      if (!image) {
        sendError(res, 404, 'That picture is not available.');
        return;
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('Content-Type', image.contentType);
      res.setHeader('Content-Length', String(image.size));
      res.send(image.data);
    } catch (err) {
      logger.error({ err }, 'Failed to load a question picture');
      sendError(res, 500, 'Could not load that picture.');
    }
  },
);

export default router;
