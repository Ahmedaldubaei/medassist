/**
 * HTML cleaning + text chunking for the ingestion pipeline.
 * Chunking follows the MedRAG pattern: ~1000 chars with 200 chars overlap,
 * packed on sentence boundaries when possible.
 */

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 200;

/** Strip scripts/styles/nav boilerplate and return collapsed plain text. */
export function cleanHtml(html: string): string {
  let text = html;
  // Remove script/style/noscript blocks entirely.
  text = text.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  // Drop common boilerplate containers (best-effort, regex-based).
  text = text.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  // Prefer the main content region when present.
  const main = text.match(/<(main|article)[^>]*>([\s\S]*?)<\/\1>/i);
  if (main?.[2]) text = main[2];
  // Strip remaining tags, decode a few entities.
  text = text.replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse whitespace.
  return text.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Split text into sentences (language-aware). */
export function splitSentences(text: string): string[] {
  // Arabic text: split after sentence-ending punctuation (including ؟ ؛ …)
  // followed by whitespace, regardless of the next character's case —
  // the Latin lookahead below would almost never match Arabic script.
  const pattern = /[\u0600-\u06FF]/.test(text)
    ? /(?<=[.!?؟؛…])\s+/
    : /(?<=[.!?;])\s+(?=[A-Z0-9"'“\(\[])/;
  return text
    .split(pattern)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface TextChunk {
  text: string;
  index: number;
}

/**
 * Pack sentences into ~CHUNK_SIZE char chunks with CHUNK_OVERLAP char overlap.
 * Overlap is taken from the tail of the previous chunk (may cut mid-sentence).
 */
export function chunkText(
  text: string,
  size: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP,
): TextChunk[] {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  if (cleaned.length <= size) return [{ text: cleaned, index: 0 }];

  const sentences = splitSentences(cleaned);
  // Fallback: no sentence boundaries found -> hard sliding window.
  const units = sentences.length > 1 ? sentences : [cleaned];

  const chunks: TextChunk[] = [];
  let current = '';

  const push = () => {
    if (current.trim()) chunks.push({ text: current.trim(), index: chunks.length });
  };

  for (const unit of units) {
    if ((current + ' ' + unit).trim().length <= size) {
      current = (current + ' ' + unit).trim();
      continue;
    }
    if (current) {
      push();
      // Overlap: keep the last `overlap` chars of the finished chunk.
      const tail = current.slice(-overlap);
      current = tail + ' ' + unit;
      // If a single unit is huge, hard-split it.
      while (current.length > size + overlap) {
        const hard = current.slice(0, size);
        chunks.push({ text: hard.trim(), index: chunks.length });
        current = current.slice(size - overlap);
      }
      current = current.trim();
    } else {
      // Single unit larger than size: hard-split.
      let rest = unit;
      while (rest.length > size) {
        chunks.push({ text: rest.slice(0, size).trim(), index: chunks.length });
        rest = rest.slice(size - overlap);
      }
      current = rest.trim();
    }
  }
  push();
  return chunks;
}
