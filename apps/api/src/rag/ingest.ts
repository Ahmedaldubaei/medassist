/**
 * Knowledge ingestion: raw text/URL -> cleaned -> chunked -> embedded ->
 * KnowledgeDocument + KnowledgeChunk rows.
 *
 * Embeddings are written with raw SQL because Prisma cannot write
 * pgvector columns through the typed client.
 */
import { randomUUID } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { chunkText, cleanHtml, CHUNK_OVERLAP, CHUNK_SIZE } from './chunk.js';
import { getEmbedProvider, type EmbedProvider } from './embeddings.js';

export interface IngestInput {
  title: string;
  source: string;
  license: string;
  text: string;
  /** Raw text is assumed English unless marked otherwise. */
  lang?: 'en' | 'ar';
  url?: string;
  guidelineYear?: number;
  specialty?: string;
}

export interface IngestResult {
  documentId: string;
  title: string;
  chunks: number;
}

const MAX_FETCH_BYTES = 2_000_000;
const MAX_PDF_BYTES = 10_000_000;
const FETCH_TIMEOUT_MS = 25_000;
const MAX_REDIRECTS = 3;

/** Extract text from a PDF buffer using pdftotext (must be installed). */
async function pdfToText(buf: Buffer): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const execFileAsync = promisify(execFile);

  const dir = await mkdtemp(join(tmpdir(), 'medassist-pdf-'));
  try {
    const pdfPath = join(dir, 'doc.pdf');
    const txtPath = join(dir, 'doc.txt');
    await writeFile(pdfPath, buf);
    await execFileAsync('pdftotext', ['-layout', pdfPath, txtPath], { timeout: 60_000 });
    const text = await readFile(txtPath, 'utf8');
    return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Fetch a URL (HTML or PDF) and return cleaned plain text (throws on failure). */
export async function fetchUrlText(url: string): Promise<{ text: string; title: string }> {
  let current = url;
  // Manual redirect chain so every hop is SSRF-validated (fetch's automatic
  // redirects would skip the check on the Location target).
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = await assertPublicUrl(current);
    const res = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': 'MedAssist-RAG/0.1 (+knowledge-ingestion; contact: admin@localhost)',
        Accept: 'text/html,application/xhtml+xml,application/pdf',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop === MAX_REDIRECTS) throw new Error(`[ingest] too many redirects: ${url}`);
      current = new URL(location, parsed.toString()).toString();
      continue;
    }
    return await extractBody(res, url);
  }
  throw new Error(`[ingest] too many redirects: ${url}`);
}

/** True for IPs that must never be fetched server-side (SSRF guard). */
export function isBlockedIp(ip: string): boolean {
  // IPv4-mapped IPv6 (e.g. ::ffff:10.0.0.1) -> check the embedded v4 part.
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const [a = 0, b = 0] = v4.split('.').map(Number);
    return (
      a === 10 || // 10.0.0.0/8
      a === 127 || // 127.0.0.0/8 loopback
      a === 0 || // 0.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 169 && b === 254) || // 169.254.0.0/16 link-local (cloud metadata)
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
      a >= 224 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    );
  }
  const lower = ip.toLowerCase();
  return (
    lower === '::1' || // loopback
    lower.startsWith('fe80:') || // link-local
    lower.startsWith('fc') || // fc00::/7 unique local
    lower.startsWith('fd') // fd00::/8 unique local
  );
}

/**
 * Validate a URL for server-side fetching: http(s) only, hostname must
 * resolve to a public IP. Throws on any violation.
 */
export async function assertPublicUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`[ingest] invalid URL: ${url}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`[ingest] unsupported protocol: ${parsed.protocol}`);
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`[ingest] invalid host: ${url}`);
  }
  let address: string;
  try {
    address = (await dnsLookup(parsed.hostname)).address;
  } catch {
    throw new Error(`[ingest] DNS resolution failed: ${parsed.hostname}`);
  }
  if (isBlockedIp(address)) {
    throw new Error(`[ingest] blocked private/internal host: ${parsed.hostname}`);
  }
  return parsed;
}

async function extractBody(res: Response, url: string): Promise<{ text: string; title: string }> {
  if (!res.ok) {
    throw new Error(`[ingest] fetch failed (${res.status} ${res.statusText}): ${url}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const buf = Buffer.from(await res.arrayBuffer());

  if (/application\/pdf/i.test(contentType) || url.toLowerCase().endsWith('.pdf')) {
    if (buf.length > MAX_PDF_BYTES) throw new Error(`[ingest] PDF too large (${buf.length} bytes): ${url}`);
    const text = await pdfToText(buf);
    if (text.length < 200) throw new Error(`[ingest] PDF text too short (${text.length} chars): ${url}`);
    return { text, title: new URL(url).pathname.split('/').pop() ?? url };
  }

  if (!/text\/html|application\/xhtml/i.test(contentType)) {
    throw new Error(`[ingest] unsupported content-type ${contentType}: ${url}`);
  }
  if (buf.length > MAX_FETCH_BYTES) {
    throw new Error(`[ingest] page too large (${buf.length} bytes): ${url}`);
  }
  const html = buf.toString('utf8');
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const text = cleanHtml(html);
  if (text.length < 200) {
    throw new Error(`[ingest] extracted text too short (${text.length} chars) — page may be JS-rendered or blocked: ${url}`);
  }
  return { text, title: titleMatch?.[1]?.replace(/\s+/g, ' ').trim() ?? url };
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.map((v) => Number(v.toFixed(6))).join(',')}]`;
}

/**
 * Ingest one document. `provider` is injectable for tests
 * (defaults to the configured singleton).
 */
export async function ingestDocument(input: IngestInput, provider?: EmbedProvider): Promise<IngestResult> {
  const text = input.text.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('[ingest] empty text');
  const embedder = provider ?? (await getEmbedProvider());

  const chunks = chunkText(text, CHUNK_SIZE, CHUNK_OVERLAP);
  if (chunks.length === 0) throw new Error('[ingest] no chunks produced');

  // Embed all chunks as passages (batched inside the provider).
  const vectors = await embedder.embed(chunks.map((c) => c.text), 'passage');
  if (vectors.length !== chunks.length) {
    throw new Error(`[ingest] embedding count mismatch: ${vectors.length} != ${chunks.length}`);
  }

  const doc = await prisma.knowledgeDocument.create({
    data: {
      title: input.title,
      source: input.source,
      license: input.license,
      url: input.url,
      guidelineYear: input.guidelineYear,
      specialty: input.specialty ?? 'ANESTHESIOLOGY',
    },
  });

  const isAr = input.lang === 'ar';
  const inserts = chunks.map((chunk, i) =>
    prisma.$executeRaw(
      Prisma.sql`INSERT INTO "KnowledgeChunk"
        (id, "documentId", section, "textEn", "textAr", embedding)
        VALUES (${randomUUID()}, ${doc.id}, ${`chunk-${chunk.index}`},
                ${isAr ? null : chunk.text}, ${isAr ? chunk.text : null},
                ${toVectorLiteral(vectors[i]!)}::vector)`,
    ),
  );
  await prisma.$transaction(inserts);

  return { documentId: doc.id, title: doc.title, chunks: chunks.length };
}
