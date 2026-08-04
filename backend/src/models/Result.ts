import mongoose, { Schema, type Document } from 'mongoose';

/**
 * Declared but not wired to any route yet — see PROJECT_STATE.md / FEATURE_STATUS.md.
 * Do not assume this collection is populated.
 */
export interface ResultDocument extends Document {
  studentId: string;
  examId: string;
  nationalRank?: number;
  stateRank?: number;
  percentile?: number;
  xpEarned: number;
  badges: string[];
  isPublished: boolean;
}

const resultSchema = new Schema<ResultDocument>({
  studentId: { type: String, required: true },
  examId: { type: String, required: true },
  nationalRank: { type: Number },
  stateRank: { type: Number },
  percentile: { type: Number },
  xpEarned: { type: Number, default: 0 },
  badges: [{ type: String }],
  isPublished: { type: Boolean, default: false },
});

export const Result = mongoose.model<ResultDocument>('Result', resultSchema);
