# P4 — Expo UI (done 2026-10-11)

## What was built (`~/workspace/medical-ai-assistant/apps/mobile/`)

Professional Arabic-first mobile/web app (Expo SDK 57, TypeScript strict, expo-router).

### Screens (`src/app/`)
- `(auth)/login`, `(auth)/register` — clean forms, input validation, clear error messages
  (409 → "email already registered", 401 → "invalid credentials"). Register auto-signs-in
  (backend returns user only, so the app calls login right after).
- `(app)/index` — conversations list + "new chat" button.
- `(app)/chat/[id]` — chat UI: bubbles, typing indicator, auto-scroll, multiline composer.
- `(app)/settings` — language switch (AR/EN), account info, sign out.
- Root `_layout` — font loading (IBM Plex Sans Arabic), RTL direction from stored language,
  `AuthProvider`, auth gate (no token → login).

### Key components
- `AssistantMessage` — the heart of P4: parses `## Documented knowledge` / `## Model inference`
  headers (normalizes the `** ## … **` wrapping the LLM sometimes emits) into visually
  separated cards; `CitationCard` per source (title, source, guideline year, license, open-URL);
  `ConfidenceBadge` (high ≥0.75 / medium ≥0.5 / low); `DisclaimerBanner` always;
  `EmergencyBanner` (red) when `escalated: true`.
- `ui.tsx` — PrimaryButton, Field, EmptyState, LoadingView, ErrorBanner.
- No emojis anywhere in UI — `@expo/vector-icons` (MaterialIcons) only.

### i18n (`src/i18n.ts`)
Full AR/EN dictionary, `t(lang, key)`, `isRTL()`. **No hardcoded UI strings in screens.**
Language switch: persisted → `I18nManager.forceRTL` → `Updates.reloadAsync()` (native)
or `location.reload()` (web). Web also sets `document.documentElement.dir` live.

### API client (`src/api/client.ts`)
Typed: register/login/me/chat/health. `EXPO_PUBLIC_API_URL` (default `http://localhost:3000`).
Token: `expo-secure-store` on native, `localStorage` on web.
Conversation history is cached locally (`historyStore`) — the backend exposes **no**
conversation-list endpoint yet; proper `GET /conversations` is a P5 backend task.

### Identity
- App name: "MedAssist — مساعد التخدير الذكي", slug `medassist-anesthesia`.
- Colors: white / medical teal `#0E7C7B` / navy `#16324F`.
- Icon: generated `assets/icon.png` (teal rounded square, white cross + monitoring pulse line).

## Verification
- `npx tsc --noEmit` — clean.
- `npx vitest run` — **10/10 green** (`tests/i18n.test.ts`: AR/EN key parity; `tests/parseMessage.test.ts`: section splitting incl. `** ## **` normalization).
- `npx expo export -p web` — succeeds, `dist/` produced (index.html + 1.8MB bundle containing app strings).

## Run locally
```bash
cd ~/workspace/medical-ai-assistant/apps/mobile
npx expo start            # dev (Expo Go / emulator)
npx expo start --web      # web dev
EXPO_PUBLIC_API_URL=http://<lan-ip>:3000 npx expo start   # point at backend from a device
npx expo export -p web    # production web bundle → dist/
```
Backend must run first: `cd ../api && npm run start` (port 3000).

## Decisions & notes
- Routes live in `src/app/` per the project's AGENTS.md house rules (not `app/`).
- `react-native-markdown-display` renders answer markdown with RTL-aware styles.
- Dependency quirks (documented): `react-native-markdown-display`, `vitest`, `react-native-web`,
  `react-dom` needed `--legacy-peer-deps` (react 19.2.3 vs react-dom 19.3.0 peer skew);
  vitest pinned to v2 line (v5.0.3's dist requires `vite/module-runner`, absent from vite 5.0.x).
- `expo install` wrapper was used for Expo packages; plain npm for the rest.
- No secrets in code; no real patient data; nothing modified outside `apps/mobile/`.

- `npx expo lint` — skipped: the blank template ships no eslint config and the
  CLI's lint runner fails to resolve; tsc + tests + export cover verification.

## Known limitations
- Visual screenshot verification not possible from this environment (no live browser);
  UI should be eyeballed in Expo Go / web by the parent.
- Chat history is device-local until the backend gains a list endpoint (P5).
- `expo-updates` reload is used only for the language switch, not for OTA content updates.
