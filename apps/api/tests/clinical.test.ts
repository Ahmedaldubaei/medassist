import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';
import { seedClinical } from '../src/clinical/seed.js';
import { CHECKLISTS, DRUGS } from '../src/clinical/seedData.js';

async function cleanDb() {
  await prisma.safetyReview.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.clinicalChecklist.deleteMany();
  await prisma.drugReference.deleteMany();
  await prisma.user.deleteMany();
}

async function tokenFor(app: ReturnType<typeof buildApp>, email: string) {
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, name: 'Test', password: 'secret123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'secret123' },
  });
  return login.json().token as string;
}

describe('clinical content endpoints', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(async () => {
    await cleanDb();
    await seedClinical();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects unauthenticated access with 401', async () => {
    for (const url of ['/api/v1/clinical/checklists', '/api/v1/clinical/drugs']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
  });

  it('lists all checklists with titles', async () => {
    const token = await tokenFor(app, 'c1@test.dev');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/clinical/checklists',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.checklists).toHaveLength(3);
    const keys = body.checklists.map((c: { key: string }) => c.key).sort();
    expect(keys).toEqual(['anaphylaxis', 'last', 'malignant-hyperthermia']);
  });

  it('returns checklist detail with cited steps', async () => {
    const token = await tokenFor(app, 'c2@test.dev');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/clinical/checklists/malignant-hyperthermia',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.titleAr).toBeTruthy();
    expect(Array.isArray(body.steps)).toBe(true);
    expect(body.steps.length).toBeGreaterThan(3);
    // Every step must carry a citation (safety contract).
    for (const s of body.steps) {
      expect(s.citation?.title).toBeTruthy();
      expect(s.citation?.source).toBeTruthy();
    }
  });

  it('returns 404 for unknown checklist key', async () => {
    const token = await tokenFor(app, 'c3@test.dev');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/clinical/checklists/nope',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('searches drugs by name (en + ar)', async () => {
    const token = await tokenFor(app, 'c4@test.dev');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/clinical/drugs?q=dantrolene',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.drugs).toHaveLength(1);
    expect(body.drugs[0].nameEn).toBe('Dantrolene');
    expect(body.drugs[0].entries[0].citation.title).toBeTruthy();

    const resAr = await app.inject({
      method: 'GET',
      url: encodeURI('/api/v1/clinical/drugs?q=دانترولين'),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resAr.json().drugs).toHaveLength(1);
  });

  it('lists all drugs without query', async () => {
    const token = await tokenFor(app, 'c5@test.dev');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/clinical/drugs',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().drugs.length).toBe(DRUGS.length);
  });

  it('seed data: every checklist step and drug entry has a citation', () => {
    for (const c of CHECKLISTS) {
      expect(c.steps.length).toBeGreaterThan(0);
      for (const s of c.steps) {
        expect(s.citation.title.length).toBeGreaterThan(5);
        expect(s.citation.source.length).toBeGreaterThan(3);
      }
    }
    for (const d of DRUGS) {
      expect(d.entries.length).toBeGreaterThan(0);
      for (const e of d.entries) {
        expect(e.citation.title.length).toBeGreaterThan(5);
      }
    }
  });
});
