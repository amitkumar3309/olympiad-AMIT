import mongoose, { Schema, type Document } from 'mongoose';

export interface TopicMetric {
  topicName: string;
  attempted: number;
  correct: number;
  averageTimeSeconds: number;
}

export interface LearningPoint {
  date?: string;
  accuracy?: number;
}

/**
 * Read path is real (GET /api/v1/analytics/:studentId), but nothing in the
 * codebase currently creates a document here — see PROJECT_STATE.md.
 */
export interface StudentAnalyticsDocument extends Document {
  studentId: string;
  overallAccuracy: number;
  averageSpeedPerQuestion: number;
  totalQuestionsAttempted: number;
  topicMetrics: TopicMetric[];
  learningCurve: LearningPoint[];
  aiInsights: string[];
  lastUpdated: Date;
}

const topicPerformanceSchema = new Schema<TopicMetric>(
  {
    topicName: { type: String, required: true },
    attempted: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    averageTimeSeconds: { type: Number, default: 0 },
  },
  { _id: false },
);

const studentAnalyticsSchema = new Schema<StudentAnalyticsDocument>({
  studentId: { type: String, required: true, unique: true },
  overallAccuracy: { type: Number, default: 0 },
  averageSpeedPerQuestion: { type: Number, default: 0 },
  totalQuestionsAttempted: { type: Number, default: 0 },
  topicMetrics: [topicPerformanceSchema],
  learningCurve: [
    {
      date: { type: String },
      accuracy: Number,
    },
  ],
  aiInsights: [{ type: String }],
  lastUpdated: { type: Date, default: Date.now },
});

export const StudentAnalytics = mongoose.model<StudentAnalyticsDocument>('StudentAnalytics', studentAnalyticsSchema);
