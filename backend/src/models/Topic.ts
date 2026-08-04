import mongoose, { Schema, type Document, type Types } from 'mongoose';
import { TAXONOMY_STATUSES, type TaxonomyStatus } from './Subject';

/**
 * Topics and subtopics are the **same** collection, distinguished by `parent`.
 *
 * A subtopic is a topic whose `parent` is another topic, which is why the
 * architecture supports subtopics at all without a third model: the alternative —
 * a separate `Subtopic` collection — would duplicate every field and every query,
 * and would make "list everything under this subject" two queries instead of one.
 *
 * `depth` is capped at 1 (so: topic → subtopic, and no deeper). That cap is a
 * deliberate product limit rather than a technical one — an unbounded tree makes
 * the admin UI and the question form much harder to get right, and nothing in the
 * syllabus needs three levels. Raising it means changing `MAX_TOPIC_DEPTH` and the
 * form, not the schema.
 */
export const MAX_TOPIC_DEPTH = 1;

export interface TopicDocument extends Document {
  subject: Types.ObjectId;
  /** `null` for a top-level topic; the parent topic's id for a subtopic. */
  parent?: Types.ObjectId | null;
  /** 0 for a topic, 1 for a subtopic. Derived from `parent`, never sent by a client. */
  depth: number;
  name: string;
  slug: string;
  description?: string | null;
  status: TaxonomyStatus;
  displayOrder: number;
  createdBy?: Types.ObjectId | null;
  createdByLabel?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const topicSchema = new Schema<TopicDocument>(
  {
    subject: { type: Schema.Types.ObjectId, ref: 'Subject', required: true, index: true },
    parent: { type: Schema.Types.ObjectId, ref: 'Topic', default: null },
    depth: { type: Number, default: 0, min: 0, max: MAX_TOPIC_DEPTH },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, trim: true, lowercase: true },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    status: { type: String, enum: TAXONOMY_STATUSES, default: 'active', index: true },
    displayOrder: { type: Number, default: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'Student', default: null },
    createdByLabel: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * Uniqueness is **scoped to the parent**, not global: "Fractions" may legitimately
 * exist under both Arithmetic and Algebra, and as a subtopic of each. A global
 * unique slug would reject that, which is why the slug is not unique on its own
 * here (unlike `Subject`).
 */
topicSchema.index({ subject: 1, parent: 1, slug: 1 }, { unique: true });
topicSchema.index({ subject: 1, parent: 1, displayOrder: 1, name: 1 });

export const Topic = mongoose.model<TopicDocument>('Topic', topicSchema);
