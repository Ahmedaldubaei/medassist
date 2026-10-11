# P3 — Multi-Agent System + Clinical Safety Gate (done 2026-10-11)

## What was built

### 1. LLM layer (`src/llm/`)
Provider abstraction mirroring the embeddings pattern:
- `GroqProvider` — primary. OpenAI-compatible `POST https://api.groq.com/openai/v1/chat/completions`, model `openai/gpt-oss-120b`, temp 0.2.
- `GeminiProvider` — fallback via Generative Language REST API (`x-goog-api-key` header).
- `MockProvider` — scripted responses + `calls[]` log (asserts emergency paths never touch the LLM).
- `getLlmProvider()` singleton by `LLM_PROVIDER` env; `__setLlmProvider()` test hook.
- `GROQ_API_KEY` copied from the rabt project `.env` into local `.env` (0600); never printed.

### 2. Declarative agent registry (`src/agents/registry.ts`)
The `agents.yaml` idea from the Azure research: `AGENT_REGISTRY` entries
(id, names AR/EN, description, routing `domains`, optional `knowledgeFilter`,
base `systemPrompt`). Adding a specialty = one new entry, no core changes.
Agents: `assistant`, `anesthesiology` (expert tone, RAG-mandatory, dose-only-if-verbatim),
`knowledge` (strict: chunks-only, "not found" instead of guessing).

### 3. Deterministic router (`src/agents/router.ts`)
Order: emergency scan → anesthesiology domains → greeting → medical-question → assistant.
- `detectLanguage`: Arabic/Latin script ratio (defaults to Arabic).
- `detectEmergency`: AR+EN keyword lists across 7 categories
  (cardiac/respiratory arrest, severe bleeding, anaphylaxis, seizure, chest pain, stroke).
  High-recall by design: false negatives unacceptable, false positives cheap.

### 4. Safety gate (`src/agents/safety.ts`) — the heart of P3
MediGenius `safety_router` + `dosage_grounding`, reimplemented in TypeScript,
Arabic-localized. **No LLM is ever consulted for safety decisions.**
- `preCheck(message)`: emergency → immediate AR/EN escalation text (call emergency
  services, don't wait for AI), `escalated=true`, verdict BLOCK, persisted.
- `postCheck(draft, chunks)`:
  - **Citation verification**: every `[n]` must map to a retrieved chunk; fabricated
    markers are removed and the answer flagged (never show fake references).
  - **Dosage grounding**: `extractDosages()` (EN/AR units, Unicode-aware boundary —
    `\b` is ASCII-only and missed Arabic units, fixed with `(?![\p{L}\p{N}])` + `u` flag).
    A dose is grounded only if a chunk contains a dosage *mention* with the same
    number AND same unit group (co-occurrence — the naive number+unit-anywhere check
    falsely grounded "100 mg" via "100 percent oxygen" + "2.5 mg"; fixed during P3).
    Ungrounded dose sentences are stripped → FLAG; dose-centric answers with nothing
    left → BLOCK with a safe message.
  - **Confidence**: deterministic formula from cited-chunk count and retrieval scores.
  - **Disclaimer**: always returned (AR/EN): knowledge assistant, not a substitute
    for an anesthesiologist.

### 5. Reranker (`src/rag/rerank.ts`)
Fixes the P2 hypo/hyperthermia confusion:
- Default `keyword`: token-overlap blended with RRF score + **contrast guard**
  (hyper/hypo-thermia, -tension, -glycemia, tachy/bradycardia + AR equivalents;
  opposite-condition chunks demoted 0.25×). Verified: dantrolene/MH chunk now
  outranks the higher-vector-scoring hypothermia chunk.
- Opt-in `crossencoder` (`RERANK_PROVIDER=crossencoder`):
  Xenova/ms-marco-MiniLM-L-6-v2 pair scoring via AutoTokenizer+AutoModelForSequenceClassification
  (the text-classification *pipeline* does NOT do pairs — it scored inputs
  independently; manual pair encoding works: relevant 8.25 vs irrelevant −9.43).
  Loads in ~10s, falls back to keyword on any error. Default stays `keyword`
  (offline, deterministic, zero extra RAM).

### 6. Chat endpoint (`src/routes/chat.ts` + `src/agents/pipeline.ts`)
`POST /api/v1/chat` (auth, 30/min): the mandatory path
preCheck → router → agent → postCheck → persist
(Conversation, USER+ASSISTANT Messages, AgentRun, SafetyReview) →
`{answer, citations[{title,source,guidelineYear,url,license}], confidence,
disclaimer, agentUsed, safetyVerdict, conversationId, escalated}`.
Answers keep the "Documented knowledge" / "Model inference" section split.

## Verification
- `tsc` clean; `npm test` **62/62 green** (8 files; 41 new P3 tests:
  router incl. 14-phrase 0%-fail emergency set AR+EN, safety gate incl. dose
  stripping/blocking and fabricated-citation removal, full chat e2e via Mock
  incl. persistence assertions and no-LLM-on-emergency).
- **Live (3 Groq calls, within the ≤5 budget):**
  1. "dantrolene dose malignant hyperthermia" → anesthesiology agent, FLAG
     (gate stripped ungrounded content), cited BMC dantrolene article ×3 chunks
     with source/year/license, disclaimer present.
  2. "المريض توقف عن التنفس" → 252 ms, `safety`/BLOCK/`escalated:true`,
     Arabic emergency guidance, zero LLM involvement.
  3. "ما هو تقييم ما قبل التخدير؟" → Arabic table answer citing
     NICE NG45/NG89/CG65/NG24, PASS, confidence 0.83.
- Cosmetic note: the LLM sometimes wraps `## ` headers in `** **` — harmless,
  UI can normalize in P4.

## Known limitations / next (P4+)
- Corpus is English-only; Arabic queries rely on cross-lingual vectors (works,
  verified) — Arabic sources remain scarce.
- No ivfflat index yet (fine at 50 chunks).
- Gemini fallback implemented but not live-tested (no key configured).
- `LLM_PROVIDER=mock` forced in `tests/setup.ts` so CI never hits real APIs.
