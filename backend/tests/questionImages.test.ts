import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { inspectImage, isAcceptableSize } from '../src/lib/imageFile';
import { Question, QuestionImage } from '../src/models';
import { sweepUnusedQuestionImages } from '../src/services/questionImageService';
import { startTestDb, stopTestDb, clearTestDb } from './helpers/db';
import {
  API,
  TINY_JPEG_BASE64,
  TINY_PNG_BASE64,
  cookieHeader,
  createAdminSession,
  registerVerifyLogin,
} from './helpers/auth';
import { createPublishedQuestion, createTaxonomy, validQuestion, type Taxonomy } from './helpers/questions';

/**
 * A question's pictures (Milestone 30 Phase 7b): what is stored is measured and stripped of its
 * metadata, it is served only by its random key, and only staff may add one.
 */

beforeAll(startTestDb, 60_000);
afterAll(stopTestDb);
afterEach(clearTestDb);

const SECRET = 'GPS-POSITION-OF-THE-PHONE';
const tinyJpeg = Buffer.from(TINY_JPEG_BASE64, 'base64');
const tinyPng = Buffer.from(TINY_PNG_BASE64, 'base64');

/** One JPEG segment: marker, big-endian length (which counts itself), payload. */
function jpegSegment(marker: number, payload: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
}

/** The tiny JPEG with EXIF, XMP, a comment, a colour profile and Adobe's marker inserted after SOI. */
function jpegWithMetadata(): Buffer {
  return Buffer.concat([
    tinyJpeg.subarray(0, 2),
    jpegSegment(0xe1, Buffer.from(`Exif\0\0MM\0*${SECRET}`, 'latin1')),
    jpegSegment(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${SECRET}`, 'latin1')),
    jpegSegment(0xfe, Buffer.from(`a comment: ${SECRET}`, 'latin1')),
    jpegSegment(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01profile-bytes', 'latin1')),
    jpegSegment(0xee, Buffer.from('Adobe\0\x64\0\0\0\0\x01', 'latin1')),
    tinyJpeg.subarray(2),
  ]);
}

/** One PNG chunk. The CRC is not checked by the reader, so it is left as zeros. */
function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

/** The tiny PNG with text, EXIF and timestamp chunks after its header. */
function pngWithMetadata(): Buffer {
  const afterHeader = 8 + 25; // signature + IHDR (4 + 4 + 13 + 4)
  return Buffer.concat([
    tinyPng.subarray(0, afterHeader),
    pngChunk('tEXt', Buffer.from(`Comment\0${SECRET}`, 'latin1')),
    pngChunk('eXIf', Buffer.from(`MM\0*${SECRET}`, 'latin1')),
    pngChunk('tIME', Buffer.from([0x07, 0xea, 1, 1, 0, 0, 0])),
    tinyPng.subarray(afterHeader),
  ]);
}

/** A WebP from its chunks: RIFF header, then each FourCC + little-endian size + payload (+ pad). */
function webp(...chunks: Array<[string, Buffer]>): Buffer {
  const body = Buffer.concat(
    chunks.map(([fourCc, payload]) => {
      const size = Buffer.alloc(4);
      size.writeUInt32LE(payload.length);
      return Buffer.concat([Buffer.from(fourCc, 'latin1'), size, payload, Buffer.alloc(payload.length % 2)]);
    }),
  );
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'latin1');
  header.writeUInt32LE(body.length + 4, 4);
  header.write('WEBP', 8, 'latin1');
  return Buffer.concat([header, body]);
}

/** A lossy key frame's header: frame tag, start code, then 14-bit width and height. */
function vp8(width: number, height: number): Buffer {
  const frame = Buffer.from([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, 0, 0, 0, 0, 0, 0, 0, 0]);
  frame.writeUInt16LE(width, 6);
  frame.writeUInt16LE(height, 8);
  return frame;
}

function vp8x(flags: number, width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload[0] = flags;
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return payload;
}

const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString('base64')}`;

describe('reading a picture: its size, and nothing else it carries', () => {
  it('measures a JPEG and keeps what decoding needs, dropping EXIF, XMP and comments', () => {
    const result = inspectImage(jpegWithMetadata(), 'image/jpeg');
    expect(result).not.toBeNull();
    expect(result!.width).toBe(1);
    expect(result!.height).toBe(1);
    const text = result!.data.toString('latin1');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('Exif');
    expect(text).toContain('ICC_PROFILE'); // a colour profile changes how it looks
    expect(text).toContain('Adobe'); // a CMYK file decodes wrongly without it
    // The picture itself is untouched: the result ends with the original's scan and EOI.
    expect(result!.data.subarray(0, 2).equals(tinyJpeg.subarray(0, 2))).toBe(true);
    const scan = tinyJpeg.indexOf(Buffer.from([0xff, 0xda]));
    expect(result!.data.subarray(result!.data.length - (tinyJpeg.length - scan)).equals(tinyJpeg.subarray(scan))).toBe(true);
  });

  it('measures a PNG and drops its text, EXIF and timestamp chunks', () => {
    const result = inspectImage(pngWithMetadata(), 'image/png');
    expect(result).toMatchObject({ width: 1, height: 1 });
    // With the three chunks gone it is exactly the original file.
    expect(result!.data.equals(tinyPng)).toBe(true);
  });

  it('measures a WebP of each kind, and drops EXIF and XMP from an extended one', () => {
    expect(inspectImage(webp(['VP8 ', vp8(400, 300)]), 'image/webp')).toMatchObject({ width: 400, height: 300 });

    const lossless = Buffer.alloc(5);
    lossless[0] = 0x2f;
    lossless.writeUInt32LE(99 | (49 << 14), 1);
    expect(inspectImage(webp(['VP8L', lossless]), 'image/webp')).toMatchObject({ width: 100, height: 50 });

    const ALPHA = 0x10;
    const extended = webp(
      ['VP8X', vp8x(0x08 | 0x04 | ALPHA, 640, 480)],
      ['VP8 ', vp8(640, 480)],
      ['EXIF', Buffer.from(`MM\0*${SECRET}`, 'latin1')], // odd length: exercises the pad byte
      ['XMP ', Buffer.from(`<x:xmpmeta>${SECRET}</x:xmpmeta>`, 'latin1')],
    );
    const result = inspectImage(extended, 'image/webp');
    expect(result).toMatchObject({ width: 640, height: 480 });
    const text = result!.data.toString('latin1');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('EXIF');
    // The header no longer announces what was removed, and the RIFF size is the file's.
    expect(result!.data[20]).toBe(ALPHA);
    expect(result!.data.readUInt32LE(4)).toBe(result!.data.length - 8);
  });

  it('refuses a file it cannot read as the format it claims', () => {
    expect(inspectImage(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02]), 'image/jpeg')).toBeNull();
    expect(inspectImage(tinyPng.subarray(0, 40), 'image/png')).toBeNull(); // cut before IEND
    expect(inspectImage(webp(['VP8 ', Buffer.from('not a frame')]), 'image/webp')).toBeNull();
  });

  it('knows a picture too large to ask a phone to decode', () => {
    expect(isAcceptableSize(1600, 1200)).toBe(true);
    expect(isAcceptableSize(10_001, 10)).toBe(false);
    expect(isAcceptableSize(8000, 6000)).toBe(false); // 48 megapixels
  });
});

describe('POST /admin/question-images and GET /question-images/:key', () => {
  it('stores a picture without its metadata and serves it by an unguessable key, for a year', async () => {
    const { cookies } = await createAdminSession(app);
    const upload = (bytes: Buffer) =>
      request(app)
        .post(`${API}/admin/question-images`)
        .set('Cookie', cookieHeader(cookies))
        .send({ image: dataUrl('image/jpeg', bytes) });

    const first = await upload(jpegWithMetadata()).expect(201);
    const image = first.body.image as { key: string; url: string; width: number; height: number; size: number };
    expect(image.key).toMatch(/^[0-9a-f]{32}$/);
    expect(image.url).toBe(`/api/v1/question-images/${image.key}`);
    expect(image).toMatchObject({ width: 1, height: 1, contentType: 'image/jpeg' });

    const served = await request(app).get(image.url).buffer(true).expect(200);
    expect(served.headers['content-type']).toContain('image/jpeg');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Number(served.headers['content-length'])).toBe(image.size);
    expect(Buffer.from(served.body).toString('latin1')).not.toContain(SECRET);

    // The same file again is a different picture with a different key.
    const second = await upload(jpegWithMetadata()).expect(201);
    expect(second.body.image.key).not.toBe(image.key);
  });

  it('lets only staff upload', async () => {
    const body = { image: dataUrl('image/png', tinyPng) };
    await request(app).post(`${API}/admin/question-images`).send(body).expect(401);
    const { cookies } = await registerVerifyLogin(app);
    await request(app).post(`${API}/admin/question-images`).set('Cookie', cookieHeader(cookies)).send(body).expect(403);
  });

  it('refuses a file it cannot read, and one too large to show', async () => {
    const { cookies } = await createAdminSession(app);
    const upload = (type: string, bytes: Buffer) =>
      request(app).post(`${API}/admin/question-images`).set('Cookie', cookieHeader(cookies)).send({ image: dataUrl(type, bytes) });

    const unreadable = await upload('image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('not a picture')]));
    expect(unreadable.status).toBe(400);
    expect(unreadable.body.error).toContain('could not be read');

    const huge = Buffer.from(tinyPng);
    huge.writeUInt32BE(20_000, 16); // IHDR width
    const tooLarge = await upload('image/png', huge);
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error).toContain('too large to show on a phone');
  });

  it('answers an address that is not a key with 400, and an unknown key with 404', async () => {
    await request(app).get(`${API}/question-images/1`).expect(400);
    await request(app).get(`${API}/question-images/${'a'.repeat(32)}`).expect(404);
  });
});

// ===========================================================================
// Picture questions (PLAN.md Q19)
// ===========================================================================

describe('picture questions', () => {
  const ALT = 'A right triangle with legs of 3 cm and 4 cm; the hypotenuse is marked x';

  async function setUp() {
    // Its own details, so a student registered with the defaults does not collide with it.
    const { cookies } = await createAdminSession(app, {
      firstName: 'Author',
      lastName: 'Admin',
      mobile: '9000000001',
      email: 'author@example.com',
    });
    const taxonomy = await createTaxonomy(app, cookies);
    const upload = async (type: string, bytes: Buffer) =>
      (
        await request(app)
          .post(`${API}/admin/question-images`)
          .set('Cookie', cookieHeader(cookies))
          .send({ image: dataUrl(type, bytes) })
          .expect(201)
      ).body.image as { key: string; url: string };
    const picture = await upload('image/png', tinyPng);
    const solution = await upload('image/jpeg', tinyJpeg);
    return { cookies, taxonomy, picture, solution };
  }

  /** The bank's own sample question, as a picture with a picture solution and no words at all. */
  const pictureQuestion = (taxonomy: Taxonomy, picture: { key: string }, solution: { key: string }, extra = {}) =>
    validQuestion(taxonomy, {
      questionText: '',
      image: { key: picture.key, alt: ALT },
      solution: null,
      solutionImage: { key: solution.key },
      ...extra,
    });

  it('takes a picture as the question and a picture as its worked solution, sized from the files', async () => {
    const { cookies, taxonomy, picture, solution } = await setUp();

    const created = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookieHeader(cookies))
      // A size in the request is not the picture's size, and is ignored.
      .send(pictureQuestion(taxonomy, { ...picture, width: 9999 } as { key: string }, solution))
      .expect(201);
    const question = created.body.question;
    expect(question.questionText).toBe('');
    expect(question.image).toEqual({ key: picture.key, url: picture.url, alt: ALT, width: 1, height: 1 });
    expect(question.solutionImage).toMatchObject({ key: solution.key, alt: '', width: 1, height: 1 });

    // A solution picture is a solution: the question may be published without a written one.
    await request(app)
      .patch(`${API}/admin/questions/${question.id}/status`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'published' })
      .expect(200);

    // And it is found by what its picture shows.
    const found = await request(app)
      .get(`${API}/admin/questions`)
      .query({ search: 'right triangle' })
      .set('Cookie', cookieHeader(cookies))
      .expect(200);
    expect(found.body.questions.map((row: { id: string }) => row.id)).toEqual([question.id]);
  });

  it('refuses no words and no picture, a picture without a description, and a picture never stored', async () => {
    const { cookies, taxonomy, picture, solution } = await setUp();
    const post = (body: Record<string, unknown>) =>
      request(app).post(`${API}/admin/questions`).set('Cookie', cookieHeader(cookies)).send(body);

    const bare = await post(validQuestion(taxonomy, { questionText: '' }));
    expect(bare.status).toBe(400);
    expect(JSON.stringify(bare.body)).toContain('or add a picture of the question');

    const undescribed = await post(pictureQuestion(taxonomy, picture, solution, { image: { key: picture.key, alt: ' ' } }));
    expect(undescribed.status).toBe(400);
    expect(JSON.stringify(undescribed.body)).toContain('description of the question picture is required');

    const unknown = await post(pictureQuestion(taxonomy, { key: 'f'.repeat(32) }, solution));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toContain('no longer available');
  });

  it('refuses to publish a picture question with no solution of either kind', async () => {
    const { cookies, taxonomy, picture } = await setUp();
    const created = await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookieHeader(cookies))
      .send(validQuestion(taxonomy, { questionText: '', image: { key: picture.key, alt: ALT }, solution: null }))
      .expect(201);
    const refused = await request(app)
      .patch(`${API}/admin/questions/${created.body.question.id}/status`)
      .set('Cookie', cookieHeader(cookies))
      .send({ status: 'published' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('written out or as a picture');
  });

  it('shows a student the question picture, and the solution picture only after they submit', async () => {
    const { cookies, taxonomy, picture, solution } = await setUp();
    await createPublishedQuestion(app, cookies, taxonomy, pictureQuestion(taxonomy, picture, solution));
    const student = await registerVerifyLogin(app);

    const started = await request(app)
      .post(`${API}/practice/sessions`)
      .set('Cookie', cookieHeader(student.cookies))
      .send({})
      .expect(201);
    const served = started.body.session.questions[0];
    expect(served.image).toEqual({ url: picture.url, alt: ALT, width: 1, height: 1 });
    // The solution picture's key is the permission to fetch it: nowhere before submission.
    expect(JSON.stringify(started.body)).not.toContain(solution.key);

    const submitted = await request(app)
      .post(`${API}/practice/sessions/${started.body.session.id}/submit`)
      .set('Cookie', cookieHeader(student.cookies))
      .expect(200);
    expect(submitted.body.session.questions[0].explanationImage).toMatchObject({ url: solution.url, width: 1 });
  });

  describe('importing pictures as questions (instead of OCR)', () => {
    const importPictures = (cookies: Record<string, string>, body: Record<string, unknown>) =>
      request(app).post(`${API}/admin/questions/import/pictures`).set('Cookie', cookieHeader(cookies)).send(body);

    it('makes each picture a draft candidate, saved as a picture question once described and answered', async () => {
      const { cookies, taxonomy, picture, solution } = await setUp();
      const preview = await importPictures(cookies, {
        topic: taxonomy.topicId,
        classLevel: 'Class 9',
        marks: 4,
        negativeMarks: 1,
        pictures: [{ key: picture.key, name: 'page-1.png' }],
      }).expect(200);
      expect(preview.body.kind).toBe('picture');
      // Nothing reads the picture — a statement of fact the review screen prints.
      expect(preview.body.parser.extraction).toBe('deterministic');
      const candidate = preview.body.questions[0];
      expect(candidate).toMatchObject({
        questionText: '',
        type: 'single_choice',
        options: [],
        sourceRef: 'page-1.png',
        image: { key: picture.key, url: picture.url, width: 1, height: 1 },
      });

      // The examiner describes it, writes the options, marks the answer and adds a solution picture.
      const reviewed = {
        ...candidate,
        image: { key: picture.key, alt: ALT },
        options: [
          { text: '$5$ cm', isCorrect: true },
          { text: '$7$ cm', isCorrect: false },
        ],
        solutionImage: { key: solution.key },
      };
      const approved = await request(app)
        .post(`${API}/admin/questions/import/approve`)
        .set('Cookie', cookieHeader(cookies))
        .send({ batchId: preview.body.batchId, questions: [reviewed] })
        .expect(201);
      const saved = await Question.findById(approved.body.questions[0].id).lean();
      expect(saved!.status).toBe('draft');
      expect(saved!.image).toMatchObject({ key: picture.key, alt: ALT, width: 1 });
      expect(saved!.solutionImage).toMatchObject({ key: solution.key });
      // Provenance is read back from the batch, never the request.
      expect(saved!.provenance).toMatchObject({ source: 'picture_import', generatorKind: 'deterministic', modelName: null });
    });

    it('is described to the import page as reading nothing, with its own limit', async () => {
      const { cookies } = await setUp();
      const status = await request(app).get(`${API}/admin/questions/import`).set('Cookie', cookieHeader(cookies)).expect(200);
      // The Image tab prints this instead of the photograph reader's description, which names a model.
      expect(status.body.pictures).toMatchObject({ id: 'picture', extraction: 'deterministic' });
      expect(status.body.pictures.basis).toMatch(/Nothing reads it/);
      expect(status.body.limits.maxPictures).toBe(20);
    });

    it('needs a chapter and pictures this site stored', async () => {
      const { cookies, taxonomy, picture } = await setUp();
      const noChapter = await importPictures(cookies, { classLevel: 'Class 9', pictures: [{ key: picture.key, name: 'a.png' }] });
      expect(noChapter.status).toBe(400);
      const unknown = await importPictures(cookies, {
        topic: taxonomy.topicId,
        classLevel: 'Class 9',
        pictures: [{ key: 'e'.repeat(32), name: 'gone.png' }],
      });
      expect(unknown.status).toBe(400);
      expect(unknown.body.error).toContain('no longer available');
    });

    it('does not call two picture questions duplicates because their one line reads alike', async () => {
      const { cookies, taxonomy, picture, solution } = await setUp();
      const asked = (key: string) => ({
        ...validQuestion(taxonomy, { questionText: 'Look at the figure.', image: { key, alt: ALT } }),
        topic: taxonomy.topicId,
      });
      const res = await request(app)
        .post(`${API}/admin/questions/import/validate`)
        .set('Cookie', cookieHeader(cookies))
        .send({ questions: [asked(picture.key), asked(solution.key), asked(picture.key)] })
        .expect(200);
      expect(res.body.verdicts.map((verdict: { ok: boolean }) => verdict.ok)).toEqual([true, true, false]);
      expect(res.body.verdicts[2].reason).toContain('same picture');
    });
  });

  it('removes a picture nothing shows once it is a day old — and never one a question shows', async () => {
    const { cookies, taxonomy, picture, solution } = await setUp();
    await request(app)
      .post(`${API}/admin/questions`)
      .set('Cookie', cookieHeader(cookies))
      .send(pictureQuestion(taxonomy, picture, solution))
      .expect(201);
    const abandoned = (
      await request(app)
        .post(`${API}/admin/question-images`)
        .set('Cookie', cookieHeader(cookies))
        .send({ image: dataUrl('image/png', tinyPng) })
        .expect(201)
    ).body.image.key as string;
    const fresh = (
      await request(app)
        .post(`${API}/admin/question-images`)
        .set('Cookie', cookieHeader(cookies))
        .send({ image: dataUrl('image/png', tinyPng) })
        .expect(201)
    ).body.image.key as string;

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await QuestionImage.updateMany({ key: { $in: [picture.key, solution.key, abandoned] } }, { createdAt: twoDaysAgo });

    expect(await sweepUnusedQuestionImages()).toBe(1);
    const left = (await QuestionImage.find().select('key').lean()).map((image) => image.key).sort();
    expect(left).toEqual([picture.key, solution.key, fresh].sort());
  });
});
