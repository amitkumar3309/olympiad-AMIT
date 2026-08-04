import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { Student, StudentPhoto, MAX_PHOTO_BYTES } from '../src/models';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  validStudent,
  otherStudent,
  TINY_JPEG_BASE64,
  clearTestInbox,
  cookieHeader,
  registerVerifyLogin,
  createAdminSession,
} from './helpers/auth';

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(async () => {
  await clearTestDb();
  clearTestInbox();
});

/** Registration payload with one field replaced or removed. */
function withField(field: string, value: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = { ...validStudent };
  if (value === undefined) delete body[field];
  else body[field] = value;
  return body;
}

// ---------------------------------------------------------------------------
// The point of the milestone: the details are actually persisted
// ---------------------------------------------------------------------------

describe('registration persists every collected detail', () => {
  it('writes all of them to the student document', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    const saved = await Student.findOne({ email: validStudent.email });
    expect(saved).not.toBeNull();

    // Read back from the database rather than trusting the response body — the
    // bug this milestone fixes was data being collected but never stored.
    expect(saved!.firstName).toBe('Test');
    expect(saved!.middleName).toBe('Kumar');
    expect(saved!.lastName).toBe('Student');
    expect(saved!.fatherName).toBe('Father Student');
    expect(saved!.motherName).toBe('Mother Student');
    expect(saved!.dateOfBirth.toISOString().slice(0, 10)).toBe('2010-04-15');
    expect(saved!.classLevel).toBe('Class 9');
    expect(saved!.schoolName).toBe('Springfield Public School');
    expect(saved!.address).toBe('12 Example Road, Example City, 110001');
    expect(saved!.mobile).toBe(validStudent.mobile);
  });

  it('derives fullName from the three name parts', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    const saved = await Student.findOne({ email: validStudent.email });
    expect(saved!.fullName).toBe('Test Kumar Student');
  });

  it('omits the middle name from fullName when there is none', async () => {
    await request(app)
      .post(`${API}/auth/register`)
      .send(withField('middleName', undefined))
      .expect(201);

    const saved = await Student.findOne({ email: validStudent.email });
    expect(saved!.fullName).toBe('Test Student');
    expect(saved!.middleName).toBeNull();
  });

  it('returns the stored details on the registration response', async () => {
    const res = await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);
    expect(res.body.student.classLevel).toBe('Class 9');
    expect(res.body.student.schoolName).toBe('Springfield Public School');
    expect(res.body.student.dateOfBirth).toBe('2010-04-15');
    expect(res.body.student.fatherName).toBe('Father Student');
  });
});

// ---------------------------------------------------------------------------
// Required fields
// ---------------------------------------------------------------------------

describe('the mandatory fields are actually mandatory', () => {
  const required = [
    'firstName',
    'lastName',
    'fatherName',
    'motherName',
    'dateOfBirth',
    'classLevel',
    'schoolName',
    'address',
    'mobile',
    'email',
    'photo',
  ];

  for (const field of required) {
    it(`refuses a registration missing ${field}`, async () => {
      const res = await request(app).post(`${API}/auth/register`).send(withField(field, undefined));

      expect(res.status).toBe(400);
      // A missing field is a client error; it must never reach the database and
      // surface as a 500 (the weak-assertion lesson in CLAUDE.md).
      expect(res.status).not.toBe(500);
      expect(res.status).not.toBe(201);
      expect(await Student.countDocuments({})).toBe(0);
    });
  }

  it('accepts a registration with no middle name', async () => {
    await request(app).post(`${API}/auth/register`).send(withField('middleName', undefined)).expect(201);
  });

  it('accepts an empty middle name and stores it as null', async () => {
    await request(app).post(`${API}/auth/register`).send(withField('middleName', '  ')).expect(201);
    const saved = await Student.findOne({ email: validStudent.email });
    expect(saved!.middleName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Field-level rules
// ---------------------------------------------------------------------------

describe('class level', () => {
  it('accepts each of the ten offered classes', async () => {
    const classes = [
      'Class 5',
      'Class 6',
      'Class 7',
      'Class 8',
      'Class 9',
      'Class 10',
      'Class 11',
      'Class 12 - Science',
      'Class 12 - Commerce',
      'Class 12 - Humanities',
    ];

    for (const [index, classLevel] of classes.entries()) {
      const body = {
        ...validStudent,
        classLevel,
        mobile: `90000000${String(index).padStart(2, '0')}`,
        email: `class-${index}@example.com`,
      };
      await request(app).post(`${API}/auth/register`).send(body).expect(201);
    }

    expect(await Student.countDocuments({})).toBe(classes.length);
  });

  it('refuses a class outside the offered list', async () => {
    const res = await request(app).post(`${API}/auth/register`).send(withField('classLevel', 'Class 4'));
    expect(res.status).toBe(400);
    expect(await Student.countDocuments({})).toBe(0);
  });

  it('refuses class 12 without a stream', async () => {
    const res = await request(app).post(`${API}/auth/register`).send(withField('classLevel', 'Class 12'));
    expect(res.status).toBe(400);
  });
});

describe('date of birth', () => {
  it('refuses a date in the future', async () => {
    const nextYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const res = await request(app).post(`${API}/auth/register`).send(withField('dateOfBirth', nextYear));
    expect(res.status).toBe(400);
  });

  it('refuses an implausible year', async () => {
    const res = await request(app).post(`${API}/auth/register`).send(withField('dateOfBirth', '1901-01-01'));
    expect(res.status).toBe(400);
  });

  it('refuses a non-date string', async () => {
    const res = await request(app).post(`${API}/auth/register`).send(withField('dateOfBirth', 'yesterday'));
    expect(res.status).toBe(400);
  });
});

describe('names', () => {
  it('accepts a name in a non-Latin script', async () => {
    await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, firstName: 'अमित', lastName: 'कुमार' })
      .expect(201);

    const saved = await Student.findOne({ email: validStudent.email });
    expect(saved!.fullName).toBe('अमित Kumar कुमार');
  });

  it('refuses a name containing digits', async () => {
    const res = await request(app).post(`${API}/auth/register`).send(withField('firstName', 'Test1'));
    expect(res.status).toBe(400);
  });

  it('refuses a one-character first name', async () => {
    const res = await request(app).post(`${API}/auth/register`).send(withField('firstName', 'T'));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Photo storage
// ---------------------------------------------------------------------------

describe('the registration photo', () => {
  it('is stored in its own collection, not on the student document', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    const saved = await Student.findOne({ email: validStudent.email });
    const photo = await StudentPhoto.findOne({ student: saved!._id });

    expect(photo).not.toBeNull();
    expect(photo!.contentType).toBe('image/jpeg');
    expect(photo!.size).toBe(Buffer.from(TINY_JPEG_BASE64, 'base64').length);
    expect(photo!.data.length).toBe(photo!.size);

    // The binary must not be duplicated onto the account itself — every student
    // query would otherwise carry it.
    expect(JSON.stringify(saved!.toObject())).not.toContain(TINY_JPEG_BASE64.slice(0, 40));
  });

  it('refuses a photo over the 2 MB limit', async () => {
    // Real JPEG magic bytes followed by enough padding to exceed the ceiling, so
    // the size check is what rejects it rather than the format check.
    const oversized = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_PHOTO_BYTES + 1024, 0x41)]);
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send(withField('photo', `data:image/jpeg;base64,${oversized.toString('base64')}`));

    expect(res.status).toBe(400);
    expect(await Student.countDocuments({})).toBe(0);
    expect(await StudentPhoto.countDocuments({})).toBe(0);
  });

  it('refuses a non-image file dressed up as an image', async () => {
    const script = Buffer.from('<script>alert(1)</script>').toString('base64');
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send(withField('photo', `data:image/png;base64,${script}`));

    expect(res.status).toBe(400);
    expect(await Student.countDocuments({})).toBe(0);
  });

  it('refuses an image type that is not JPEG, PNG or WebP', async () => {
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send(withField('photo', `data:image/gif;base64,${TINY_JPEG_BASE64}`));

    expect(res.status).toBe(400);
  });

  it('refuses a photo that is not a data URL at all', async () => {
    const res = await request(app)
      .post(`${API}/auth/register`)
      .send(withField('photo', 'https://example.com/photo.jpg'));

    expect(res.status).toBe(400);
  });

  it('leaves no orphaned photo when registration is rejected for a duplicate mobile', async () => {
    await request(app).post(`${API}/auth/register`).send(validStudent).expect(201);

    await request(app)
      .post(`${API}/auth/register`)
      .send({ ...validStudent, email: 'second@example.com' })
      .expect(409);

    expect(await StudentPhoto.countDocuments({})).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Reading a photo back
// ---------------------------------------------------------------------------

describe('GET /students/:studentId/photo', () => {
  it('serves a student their own photo as image bytes', async () => {
    const { cookies, studentId } = await registerVerifyLogin(app);

    const res = await request(app)
      .get(`${API}/students/${studentId}/photo`)
      .set('Cookie', cookieHeader(cookies))
      .expect(200);

    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(res.body).toBeInstanceOf(Buffer);
    expect(res.body.equals(Buffer.from(TINY_JPEG_BASE64, 'base64'))).toBe(true);
    // Personal data behind an authorization check must not land in a shared cache.
    expect(res.headers['cache-control']).toContain('private');
  });

  it('refuses an anonymous request', async () => {
    const { studentId } = await registerVerifyLogin(app);
    const res = await request(app).get(`${API}/students/${studentId}/photo`);
    expect(res.status).toBe(401);
  });

  it("refuses one student reading another student's photo", async () => {
    const first = await registerVerifyLogin(app);
    const second = await registerVerifyLogin(app, otherStudent);

    const res = await request(app)
      .get(`${API}/students/${first.studentId}/photo`)
      .set('Cookie', cookieHeader(second.cookies));

    expect(res.status).toBe(403);
    expect(res.status).not.toBe(200);
  });

  it('lets an administrator read any photo', async () => {
    const student = await registerVerifyLogin(app);
    const admin = await createAdminSession(app, {
      mobile: '9555000111',
      email: 'staff@example.com',
    });

    await request(app)
      .get(`${API}/students/${student.studentId}/photo`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);
  });

  it('answers 404 for a student ID that does not exist', async () => {
    const { cookies } = await registerVerifyLogin(app);
    const res = await request(app)
      .get(`${API}/students/AMIT_9999/photo`)
      .set('Cookie', cookieHeader(cookies));

    expect([403, 404]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });

  it('is gated identically on the unversioned /api alias', async () => {
    const first = await registerVerifyLogin(app);
    const second = await registerVerifyLogin(app, otherStudent);

    const res = await request(app)
      .get(`/api/students/${first.studentId}/photo`)
      .set('Cookie', cookieHeader(second.cookies));

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// The administrative view
// ---------------------------------------------------------------------------

describe('the admin account view exposes the new details', () => {
  it('includes them on the student detail endpoint', async () => {
    const student = await registerVerifyLogin(app);
    const admin = await createAdminSession(app, {
      mobile: '9555000222',
      email: 'staff2@example.com',
    });

    const res = await request(app)
      .get(`${API}/admin/students/${student.studentId}`)
      .set('Cookie', cookieHeader(admin.cookies))
      .expect(200);

    expect(res.body.student.classLevel).toBe('Class 9');
    expect(res.body.student.schoolName).toBe('Springfield Public School');
    expect(res.body.student.fatherName).toBe('Father Student');
    expect(res.body.student.motherName).toBe('Mother Student');
    expect(res.body.student.dateOfBirth).toBe('2010-04-15');
    expect(res.body.student.address).toBe('12 Example Road, Example City, 110001');
  });
});

// ---------------------------------------------------------------------------
// Legacy accounts
// ---------------------------------------------------------------------------

describe('accounts created before Milestone 4', () => {
  it('can still be administered even though they lack the new fields', async () => {
    // Written straight to the collection, bypassing the model, exactly as a
    // pre-Milestone-4 document exists in the database today.
    await Student.collection.insertOne({
      fullName: 'Legacy Student',
      mobile: '9000000001',
      email: 'legacy@example.com',
      passwordHash: 'x',
      studentId: 'AMIT_0001',
      isEmailVerified: true,
      status: 'active',
      role: 'student',
      tokenVersion: 0,
      failedLoginAttempts: 0,
      registeredAt: new Date(),
    });

    const admin = await createAdminSession(app, {
      mobile: '9555000333',
      email: 'staff3@example.com',
    });

    // Suspension calls save() on the legacy document. If the new fields were
    // plainly `required` this would fail validation on data the admin never
    // touched — which is why the schema scopes the requirement to new documents.
    const res = await request(app)
      .patch(`${API}/admin/students/AMIT_0001/status`)
      .set('Cookie', cookieHeader(admin.cookies))
      .send({ status: 'suspended', reason: 'testing legacy save' });

    expect(res.status).toBe(200);
    expect(res.status).not.toBe(500);

    const after = await Student.findOne({ studentId: 'AMIT_0001' });
    expect(after!.status).toBe('suspended');
  });
});
