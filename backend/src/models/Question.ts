import mongoose, { Schema, type Document } from 'mongoose';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

export interface QuestionDocument extends Document {
  questionText: string;
  options: string[];
  correctAnswer: string;
  classLevel: string;
  subject: string;
  difficulty: Difficulty;
  createdAt: Date;
}

const questionSchema = new Schema<QuestionDocument>({
  questionText: { type: String, required: true },
  options: [{ type: String, required: true }],
  correctAnswer: { type: String, required: true },
  classLevel: { type: String, required: true },
  subject: { type: String, default: 'Mathematics' },
  difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Medium' },
  createdAt: { type: Date, default: Date.now },
});

export const Question = mongoose.model<QuestionDocument>('Question', questionSchema);
