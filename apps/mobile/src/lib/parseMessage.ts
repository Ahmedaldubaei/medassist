/**
 * Parses an assistant answer into visual sections.
 * The backend emits "## Documented knowledge" / "## Model inference" headers
 * (the LLM sometimes wraps them as "** ## ... **" — normalized here).
 */

export interface MessageSection {
  /** 'documented' | 'inference' | 'plain' */
  kind: 'documented' | 'inference' | 'plain';
  title: string | null;
  body: string;
}

const HEADER_RE = /^\s*(?:\*\*\s*)?##\s*(.+?)(?:\s*\*\*)?\s*$/;

function classifyHeader(header: string): 'documented' | 'inference' | null {
  const h = header.trim().toLowerCase();
  if (/documented knowledge|معرفة موثقة/.test(h)) return 'documented';
  if (/model inference|استنتاج النموذج/.test(h)) return 'inference';
  return null;
}

/** Split raw markdown into sections by ## headers. */
export function parseMessageSections(raw: string): MessageSection[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const sections: MessageSection[] = [];
  let current: { kind: MessageSection['kind']; title: string | null; lines: string[] } | null = null;

  const push = () => {
    if (current && current.lines.join('\n').trim().length > 0) {
      sections.push({ kind: current.kind, title: current.title, body: current.lines.join('\n').trim() });
    }
    current = null;
  };

  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    const kind = m ? classifyHeader(m[1] ?? '') : null;
    if (m && kind) {
      push();
      current = { kind, title: m[1]!.trim(), lines: [] };
    } else if (m && !kind) {
      // Unknown ## header: keep it as content inside a plain section.
      if (!current) current = { kind: 'plain', title: null, lines: [] };
      current.lines.push(line);
    } else {
      if (!current) current = { kind: 'plain', title: null, lines: [] };
      current.lines.push(line);
    }
  }
  push();
  return sections.length > 0 ? sections : [{ kind: 'plain', title: null, body: raw.trim() }];
}
