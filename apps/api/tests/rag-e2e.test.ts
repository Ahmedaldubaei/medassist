import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';
import { hybridSearch } from '../src/rag/retrieve.js';
import { __setEmbedProvider, type EmbedProvider } from '../src/rag/embeddings.js';

/**
 * Deterministic fake embedder: 384-dim vectors built from a small
 * medical vocabulary, so semantically related texts are near each other.
 * Never touches the network or loads a model.
 */
class FakeProvider implements EmbedProvider {
  readonly name = 'fake';
  readonly dim = 384;
  private vocab = ['malignant', 'hyperthermia', 'dantrolene', 'fasting', 'anesthesia', 'airway'];

  async embed(texts: string[], _kind: 'query' | 'passage'): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(384).fill(0);
      const low = t.toLowerCase();
      this.vocab.forEach((w, i) => {
        if (low.includes(w)) v[i] = 1;
      });
      v[100] = 0.01; // avoid the zero vector
      const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
      return v.map((x) => x / n);
    });
  }
}

const fake = new FakeProvider();

const MH_TEXT = (
  'Malignant hyperthermia is a severe pharmacogenetic reaction to volatile anesthetics and succinylcholine. ' +
  'Early signs include rising end-tidal CO2, tachycardia, and muscle rigidity. ' +
  'The definitive treatment for malignant hyperthermia is immediate dantrolene administration, ' +
  'hyperventilation with 100% oxygen, and active cooling measures. ' +
  'Dantrolene dosing starts at 2.5 mg per kg intravenously and may be repeated. '
).repeat(12); // ~3600 chars -> several chunks

const FASTING_TEXT = (
  'Preoperative fasting guidelines recommend no solid food for six hours and clear fluids up to two hours ' +
  'before elective anesthesia in healthy adults. ' +
  'Fasting reduces the risk of pulmonary aspiration during anesthesia induction. '
).repeat(12);

async function cleanDb() {
  await prisma.safetyReview.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.user.deleteMany();
}

describe('rag e2e (fake embeddings)', () => {
  const app = buildApp();

  beforeAll(async () => {
    __setEmbedProvider(fake);
    await app.ready();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  afterAll(async () => {
    __setEmbedProvider(null);
    await app.close();
    await prisma.$disconnect();
  });

  it('ingest -> hybrid search returns the relevant document first, with metadata', async () => {
    const mh = await ingestDocument(
      { title: 'MH crisis management', source: 'test-source', license: 'test', text: MH_TEXT, guidelineYear: 2020 },
      fake,
    );
    await ingestDocument(
      { title: 'Preoperative fasting', source: 'test-source', license: 'test', text: FASTING_TEXT },
      fake,
    );
    expect(mh.chunks).toBeGreaterThan(1);

    // Embedding dimension stored in pgvector matches the provider.
    const dims = (await prisma.$queryRaw`SELECT DISTINCT vector_dims(embedding) AS d FROM "KnowledgeChunk"`) as {
      d: number;
    }[];
    expect(dims.map((r) => r.d)).toEqual([384]);

    const results = await hybridSearch('malignant hyperthermia treatment dantrolene', { k: 5 }, fake);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.documentId).toBe(mh.documentId);
    expect(results[0]!.title).toBe('MH crisis management');
    expect(results[0]!.source).toBe('test-source');
    expect(results[0]!.license).toBe('test');
    expect(results[0]!.guidelineYear).toBe(2020);
    expect(results[0]!.score).toBeGreaterThan(0);
    expect(results[0]!.textEn).toContain('dantrolene');
  });

  it('POST /api/v1/admin/ingest is ADMIN-only', async () => {
    const adminReg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'admin2@example.com', name: 'Admin', password: 'secret123' },
    });
    expect(adminReg.statusCode).toBe(201); // first user -> ADMIN
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'admin2@example.com', password: 'secret123' },
    });
    const adminToken = adminLogin.json().token as string;

    const studentReg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'student@example.com', name: 'Student', password: 'secret123' },
    });
    expect(studentReg.statusCode).toBe(201);
    const studentLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'student@example.com', password: 'secret123' },
    });
    const studentToken = studentLogin.json().token as string;

    const payload = {
      title: 'Route ingest doc',
      text: MH_TEXT,
      source: 'route-test',
      license: 'test',
    };

    // No token -> 401
    const anon = await app.inject({ method: 'POST', url: '/api/v1/admin/ingest', payload });
    expect(anon.statusCode).toBe(401);

    // STUDENT -> 403
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingest',
      headers: { authorization: `Bearer ${studentToken}` },
      payload,
    });
    expect(forbidden.statusCode).toBe(403);

    // ADMIN -> 201 (uses the fake provider via __setEmbedProvider)
    const ok = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingest',
      headers: { authorization: `Bearer ${adminToken}` },
      payload,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().document.chunks).toBeGreaterThan(1);

    // Duplicate URL -> 409
    const withUrl = { ...payload, url: 'https://example.com/doc1' };
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingest',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: withUrl,
    });
    expect(first.statusCode).toBe(201);
    const dup = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingest',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: withUrl,
    });
    expect(dup.statusCode).toBe(409);
  });

  it('POST /api/v1/knowledge/search requires auth and returns ranked chunks', async () => {
    await ingestDocument(
      { title: 'MH crisis management', source: 'test-source', license: 'CC-BY-4.0', text: MH_TEXT, guidelineYear: 2021 },
      fake,
    );
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 's2@example.com', name: 'S', password: 'secret123' },
    });
    const token = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 's2@example.com', password: 'secret123' },
      })
    ).json().token as string;
    expect(reg.statusCode).toBe(201);

    const anon = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge/search',
      payload: { query: 'malignant hyperthermia' },
    });
    expect(anon.statusCode).toBe(401);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge/search',
      headers: { authorization: `Bearer ${token}` },
      payload: { query: 'malignant hyperthermia dantrolene treatment', k: 3 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].license).toBe('CC-BY-4.0');
    expect(body.results[0].score).toBeGreaterThan(0);
  });
});
