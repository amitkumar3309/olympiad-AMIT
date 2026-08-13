import { Router, type Request, type Response } from 'express';
import { requirePermission } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { ensureDb } from '../../middleware/ensureDb';
import { GalleryItem, type GalleryItemDocument, type GalleryStatus } from '../../models';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import { recordAudit } from '../../lib/audit';
import { logger } from '../../lib/logger';
import {
  listGalleryQuerySchema,
  createGalleryItemSchema,
  updateGalleryItemSchema,
  idParamSchema,
  type ListGalleryQuery,
  type CreateGalleryItemInput,
  type UpdateGalleryItemInput,
} from '../../validation/contentSchemas';

/**
 * The public event gallery (Milestone 12).
 *
 * Photographs of real olympiad events, uploaded by staff. The only content in this
 * product that is **published to the open internet** rather than served to a
 * signed-in student, which is why it has its own permission (`gallery:write`) and
 * why every mutation is audited.
 *
 * Image bytes are never included in a listing — `GalleryItem.data` is `select:
 * false`, and the one route that serves bytes opts in explicitly. See the model for
 * the storage budget this operates under.
 */
const router = Router();

/** Metadata only. The bytes are fetched separately, one image at a time. */
function galleryView(item: GalleryItemDocument) {
  return {
    id: String(item._id),
    title: item.title,
    caption: item.caption ?? null,
    eventDate: item.eventDate ? item.eventDate.toISOString().slice(0, 10) : null,
    status: item.status,
    displayOrder: item.displayOrder,
    contentType: item.contentType,
    size: item.size,
    uploadedByLabel: item.uploadedByLabel ?? null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt ?? null,
    /** Where to fetch the bytes. Same path for staff and the public. */
    imageUrl: `/api/v1/gallery/${String(item._id)}/image`,
  };
}

interface GalleryFilter {
  status?: GalleryStatus;
  $or?: Array<{ title?: RegExp } | { caption?: RegExp }>;
}

/** Escapes a user-supplied string so it is matched literally, never as a pattern. */
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/**
 * The gallery as a visitor sees it: published items only, in the order staff chose.
 *
 * Public and unauthenticated by design — this is a marketing surface, and it
 * carries no personal data: a title, a caption and a photograph the organisers
 * chose to publish. Paginated like every other listing so it cannot be used to pull
 * the whole collection in one request.
 */
router.get('/gallery', validate({ query: listGalleryQuerySchema }), ensureDb, async (req: Request, res: Response) => {
  try {
    const { page, limit } = req.query as unknown as ListGalleryQuery;

    const filter: GalleryFilter = { status: 'published' };
    const [items, total] = await Promise.all([
      GalleryItem.find(filter)
        .sort({ displayOrder: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      GalleryItem.countDocuments(filter),
    ]);

    sendSuccess(res, 200, {
      gallery: items.map(galleryView),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) {
    logger.error({ err }, 'Failed to load the gallery');
    sendError(res, 500, 'Could not load the gallery right now.');
  }
});

/**
 * The image bytes.
 *
 * Public, but only for a **published** item: an archived photo has been taken down,
 * and continuing to serve its bytes to anyone holding the URL would make archiving
 * a UI change rather than a removal.
 */
router.get(
  '/gallery/:id/image',
  validate({ params: idParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      // `+data` opts back into the bytes the schema excludes by default.
      const item = await GalleryItem.findById(req.params.id).select('+data status contentType size');
      if (!item || item.status !== 'published') {
        sendError(res, 404, 'That image is not available.');
        return;
      }

      // Public content with no authorization behind it, so a shared cache is safe
      // and wanted — unlike a student's registration photo, which is `private`.
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Content-Type', item.contentType);
      res.setHeader('Content-Length', String(item.size));
      res.send(item.data);
    } catch (err) {
      logger.error({ err }, 'Failed to load a gallery image');
      sendError(res, 500, 'Could not load that image.');
    }
  },
);

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

router.get(
  '/admin/gallery',
  requirePermission('gallery:write'),
  validate({ query: listGalleryQuerySchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { page, limit, status, search } = req.query as unknown as ListGalleryQuery;

      // Built field by field from validated values only, so no operator object
      // from req.query can reach Mongo.
      const filter: GalleryFilter = {};
      if (status) filter.status = status;
      if (search) {
        const pattern = new RegExp(escapeRegex(search), 'i');
        filter.$or = [{ title: pattern }, { caption: pattern }];
      }

      const [items, total] = await Promise.all([
        GalleryItem.find(filter)
          .sort({ displayOrder: 1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit),
        GalleryItem.countDocuments(filter),
      ]);

      sendSuccess(res, 200, {
        gallery: items.map(galleryView),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      });
    } catch (err) {
      logger.error({ err }, 'Failed to list gallery items');
      sendError(res, 500, 'Could not load the gallery. Please try again.');
    }
  },
);

router.post(
  '/admin/gallery',
  requirePermission('gallery:write'),
  validate({ body: createGalleryItemSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const { title, caption, eventDate, displayOrder, status, image } = req.body as CreateGalleryItemInput;

      const item = await GalleryItem.create({
        title,
        caption: caption ?? null,
        eventDate: eventDate ?? null,
        displayOrder: displayOrder ?? 0,
        status: status ?? 'published',
        contentType: image.contentType,
        size: image.data.length,
        data: image.data,
        uploadedBy: req.user?.sub ?? null,
        uploadedByLabel: req.user?.studentId ?? req.user?.email ?? null,
      });

      await recordAudit(req, {
        action: 'gallery.changed',
        targetType: 'gallery',
        targetId: String(item._id),
        targetLabel: item.title,
        metadata: { operation: 'created', size: item.size, status: item.status },
      });

      sendSuccess(res, 201, { item: galleryView(item) });
    } catch (err) {
      logger.error({ err }, 'Failed to add a gallery item');
      sendError(res, 500, 'Could not add that photo. Please try again.');
    }
  },
);

router.patch(
  '/admin/gallery/:id',
  requirePermission('gallery:write'),
  validate({ params: idParamSchema, body: updateGalleryItemSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const updates = req.body as UpdateGalleryItemInput;
      const item = await GalleryItem.findById(req.params.id);
      if (!item) {
        sendError(res, 404, 'No gallery item with that id.');
        return;
      }

      const before = { title: item.title, status: item.status, displayOrder: item.displayOrder };

      if (updates.title !== undefined) item.title = updates.title;
      if (updates.caption !== undefined) item.caption = updates.caption ?? null;
      if (updates.eventDate !== undefined) item.eventDate = updates.eventDate ?? null;
      if (updates.displayOrder !== undefined) item.displayOrder = updates.displayOrder;
      if (updates.status !== undefined) item.status = updates.status;
      item.updatedAt = new Date();
      await item.save();

      await recordAudit(req, {
        action: 'gallery.changed',
        targetType: 'gallery',
        targetId: String(item._id),
        targetLabel: item.title,
        metadata: { operation: 'updated', from: before, to: { title: item.title, status: item.status, displayOrder: item.displayOrder } },
      });

      sendSuccess(res, 200, { item: galleryView(item) });
    } catch (err) {
      logger.error({ err }, 'Failed to update a gallery item');
      sendError(res, 500, 'Could not update that photo. Please try again.');
    }
  },
);

/**
 * Removes a photo for good.
 *
 * Unlike an account, this is staff-authored content with no history hanging off it,
 * so `gallery:write` covers deletion rather than reserving it for a super admin —
 * the same reasoning that lets an admin hard-delete a never-published question.
 * Archiving remains the reversible option and is what the UI leads with.
 */
router.delete(
  '/admin/gallery/:id',
  requirePermission('gallery:write'),
  validate({ params: idParamSchema }),
  ensureDb,
  async (req: Request, res: Response) => {
    try {
      const item = await GalleryItem.findById(req.params.id);
      if (!item) {
        sendError(res, 404, 'No gallery item with that id.');
        return;
      }

      const snapshot = { id: String(item._id), title: item.title, size: item.size };
      await GalleryItem.deleteOne({ _id: item._id });

      await recordAudit(req, {
        action: 'gallery.changed',
        targetType: 'gallery',
        targetId: snapshot.id,
        targetLabel: snapshot.title,
        metadata: { operation: 'deleted', size: snapshot.size },
      });

      sendSuccess(res, 200, { deleted: true, item: snapshot });
    } catch (err) {
      logger.error({ err }, 'Failed to delete a gallery item');
      sendError(res, 500, 'Could not delete that photo. Please try again.');
    }
  },
);

export default router;
