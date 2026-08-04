import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../../config';
import { Student, type StudentDocument } from '../../models';
import { validate } from '../../middleware/validate';
import { authLimiter } from '../../middleware/rateLimiter';
import { registerSchema, loginSchema, adminLoginSchema } from '../../validation/authSchemas';
import { sendSuccess, sendError } from '../../lib/apiResponse';
import type { AuthPayload } from '../../middleware/auth';
import { ensureDb } from '../../middleware/ensureDb';

const router = Router();

function issueStudentSession(res: Response, student: Pick<StudentDocument, '_id' | 'studentId'>): void {
  const token = jwt.sign(
    { role: 'student', sub: String(student._id), studentId: student.studentId ?? undefined },
    config.jwtSecret,
    { expiresIn: '7d' },
  );
  res.cookie(config.auth.cookieName, token, config.auth.cookieOptions);
}

router.post('/auth/register', authLimiter, validate({ body: registerSchema }), ensureDb, async (req, res) => {
  try {
    const { fullName, mobile, password } = req.body as { fullName: string; mobile: string; password: string };

    const existing = await Student.findOne({ mobile });
    if (existing) {
      sendError(res, 409, 'This mobile number is already registered.');
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const newStudent = new Student({
      fullName,
      mobile,
      passwordHash,
      studentId: `AMIT_${Math.floor(Math.random() * 10000)}`,
    });

    await newStudent.save();
    issueStudentSession(res, newStudent);

    sendSuccess(res, 200, {
      message: `Badhai ho! ${fullName} ka data Database mein save ho gaya hai.`,
      student: { fullName: newStudent.fullName, mobile: newStudent.mobile, studentId: newStudent.studentId },
    });
  } catch {
    sendError(res, 500, 'Kuch gadbad ho gayi');
  }
});

router.post('/auth/login', authLimiter, validate({ body: loginSchema }), ensureDb, async (req, res) => {
  try {
    const { mobile, password } = req.body as { mobile: string; password: string };

    const student = await Student.findOne({ mobile });
    if (!student || !(await bcrypt.compare(password, student.passwordHash))) {
      sendError(res, 401, 'Invalid mobile number or password.');
      return;
    }

    issueStudentSession(res, student);
    sendSuccess(res, 200, {
      student: { fullName: student.fullName, mobile: student.mobile, studentId: student.studentId },
    });
  } catch {
    sendError(res, 500, 'Login failed.');
  }
});

router.post('/auth/admin/login', authLimiter, validate({ body: adminLoginSchema }), ensureDb, async (req, res) => {
  try {
    const { email, password } = req.body as { email: string; password: string };
    const { email: adminEmail, passwordHash: adminPasswordHash } = config.admin;

    if (!adminEmail || !adminPasswordHash) {
      sendError(res, 500, 'Admin account is not configured.');
      return;
    }
    if (email !== adminEmail || !(await bcrypt.compare(password, adminPasswordHash))) {
      sendError(res, 401, 'Invalid admin credentials.');
      return;
    }

    const token = jwt.sign({ role: 'admin', email }, config.jwtSecret, { expiresIn: '7d' });
    res.cookie(config.auth.cookieName, token, config.auth.cookieOptions);
    sendSuccess(res, 200, { admin: { email } });
  } catch {
    sendError(res, 500, 'Admin login failed.');
  }
});

router.post('/auth/logout', (_req, res) => {
  res.clearCookie(config.auth.cookieName, config.auth.cookieOptions);
  sendSuccess(res, 200);
});

router.get('/auth/me', ensureDb, async (req, res) => {
  const token = req.cookies?.[config.auth.cookieName];
  if (!token) {
    sendError(res, 401, 'Not authenticated');
    return;
  }
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
    if (payload.role === 'admin') {
      sendSuccess(res, 200, { role: 'admin', admin: { email: payload.email } });
      return;
    }
    const student = await Student.findById(payload.sub);
    if (!student) {
      sendError(res, 401, 'Session no longer valid.');
      return;
    }
    sendSuccess(res, 200, {
      role: 'student',
      student: { fullName: student.fullName, mobile: student.mobile, studentId: student.studentId },
    });
  } catch {
    sendError(res, 401, 'Invalid or expired session');
  }
});

export default router;
