import mongoose, { Schema, type Document } from 'mongoose';

export type ExamAttemptStatus = 'In Progress' | 'Submitted' | 'Suspended';

export interface ExamAnswer {
  questionId?: string;
  selectedOption?: string;
  isCorrect?: boolean;
}

/**
 * Declared but not wired to any route yet — see PROJECT_STATE.md / FEATURE_STATUS.md.
 * Do not assume this collection is populated.
 */
export interface ExamAttemptDocument extends Document {
  studentId: string;
  startTime: Date;
  endTime?: Date;
  totalScore: number;
  accuracy: number;
  timeTakenSeconds: number;
  answers: ExamAnswer[];
  status: ExamAttemptStatus;
}

const examAttemptSchema = new Schema<ExamAttemptDocument>({
  studentId: { type: String, required: true },
  startTime: { type: Date, default: Date.now },
  endTime: { type: Date },
  totalScore: { type: Number, default: 0 },
  accuracy: { type: Number, default: 0 },
  timeTakenSeconds: { type: Number, default: 0 },
  answers: [
    {
      questionId: String,
      selectedOption: String,
      isCorrect: Boolean,
    },
  ],
  status: { type: String, enum: ['In Progress', 'Submitted', 'Suspended'], default: 'In Progress' },
});

export const ExamAttempt = mongoose.model<ExamAttemptDocument>('ExamAttempt', examAttemptSchema);
