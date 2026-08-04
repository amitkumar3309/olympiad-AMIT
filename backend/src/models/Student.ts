import mongoose, { Schema, type Document } from 'mongoose';

export interface StudentDocument extends Document {
  fullName?: string;
  mobile: string;
  passwordHash: string;
  studentId?: string;
  registeredAt: Date;
}

const studentSchema = new Schema<StudentDocument>({
  fullName: String,
  mobile: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  studentId: String,
  registeredAt: { type: Date, default: Date.now },
});

export const Student = mongoose.model<StudentDocument>('Student', studentSchema);
