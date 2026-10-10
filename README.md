# SheGuard AI

A personal safety app for women: React Native (Android) + a FastAPI backend, built local-first so
every emergency action works instantly and offline, with the backend and AI as enhancements —
never as a dependency for safety.

> **Status legend used throughout this document:** **IMPLEMENTED** (built and automated-tested),
> **PARTIAL** (built but a dependency is incomplete/blocked), **NOT IMPLEMENTED** (not built),
> **NOT VERIFIED** (built and unit-tested, but not yet confirmed on a physical device this
> session). Nothing below is marked done unless it actually is.

---

## 1. Project Overview

SheGuard AI lets a user trigger an emergency instantly (button, shake, or voice), captures their
location and audio evidence, alerts trusted contacts by SMS, and backs everything up to the cloud
when connectivity allows — without ever waiting on the network, a server, or an AI model to do so.

## 2. Problem Statement

Personal-safety apps often fail at the moment they're needed most: they wait on a network call,
a permission dialog, or a slow backend before anything actually happens. SheGuard AI's core design
principle inverts that — the phone acts first, and everything else (sync, SMS, AI) happens
alongside or after, never as a gate.

## 3. Vision

A safety app that a user can trust to work in a basement with no signal, a crowded train with a
spotty connection, or a new phone they just signed into — because the emergency path never depends
on any of that.

## 4. Features

See the **Final Feature Matrix** (§34) for the authoritative, status-tagged list.

## 5. Safety Architecture

```
Manual SOS / Shake / Voice / (Hardware — not implemented)
                │
                ▼
        EmergencyCoordinator  ← single authority for emergency lifecycle
                │               (one open emergency at a time; local-first)
        ┌───────┼────────────────────┬─────────────────┐
        ▼       ▼                    ▼                 ▼
   Location  Evidence          Server sync        Trusted-contact
   capture   recording      (when connected)       SMS dispatch
```

Non-negotiable invariants (see `__tests__/sync/SafetyInvariantTest.test.ts`,
`__tests__/emergency/SingleOpenEmergencyInvariantTest.test.ts`):

- Creating an emergency **never** waits on network, backend, GPS, or AI.
- Only one open emergency exists at a time per device.
- ARM (Protection Mode) gates **shake** detection only. It never gates Manual SOS or Voice SOS.
- A failure in location, evidence, SMS, or AI **never** fails or blocks the emergency itself.

## 6. Local vs Backend vs Third-Party

See §35 for the full matrix. In short: emergency creation, location capture, evidence recording,
and voice/shake detection are 100% local. The backend adds trusted-contact SMS dispatch, cloud
backup/sync, and relays Ask SheGuard to Gemini. Third parties are Fast2SMS (SMS), Google
Gemini (AI replies), Google Routes/Places (route geometry — currently blocked, see §14), and
Supabase Storage (evidence/report files).

## 7. Technology Stack

- **Mobile**: React Native 0.76.5, TypeScript, Zustand, React Navigation, Kotlin native modules
- **Backend**: Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL (SQLite for local dev)
- **Third party**: Fast2SMS (SMS), Google Gemini (`google-generativeai`), Google Routes/Places API,
  Supabase Storage (private bucket)

## 8. Complete Architecture

The mobile app follows a layered, dependency-injected design (`src/app/di/AppContainer.ts` is the
single composition root): `domain` (pure types/state machines) → `services`/`store` (Zustand,
observes domain services) → `native` (thin bridges to Kotlin modules) → `features` (screens).
Nothing upstream of `EmergencyCoordinator` is allowed to block it; everything downstream
(location, evidence, sync, route safety) subscribes to it and reacts.

The backend follows a conventional FastAPI layering: `api/v1` (routers) → `services` (business
logic) → `db/models` (SQLAlchemy) with Pydantic `schemas` for request/response contracts.

## 9. Directory Structure

```
SheGuardAI/CodeBase/
├── README.md                  ← this file
├── render.yaml                 ← Render deployment blueprint
├── .gitignore
├── package.json / package-lock.json / tsconfig.json
├── app/                        ← Android/Kotlin native project
│   └── src/main/java/com/sheguardai/app/
│       ├── activation/ ask/ config/ di/ emergency/ evidence/ location/ routesafety/ security/ ui/ voice/
├── src/                        ← React Native (TypeScript)
│   ├── activation/ api/ app/ auth/ communication/ config/ contacts/ design/ emergency/
│   ├── evidence/ features/ helplines/ history/ location/ native/ navigation/ routesafety/
│   └── storage/ sync/ types/ voice/
├── __tests__/                  ← Jest (405 tests at last full run — see §39)
├── backend/                    ← FastAPI backend
│   ├── app/
│   │   ├── api/v1/             ← health, auth, emergencies, contacts, communication,
│   │   │                          locations, ask, route_safety, evidence
│   │   ├── core/                (config, security, dependencies)
│   │   ├── db/models/           (SQLAlchemy models)
│   │   ├── schemas/             (Pydantic request/response contracts)
│   │   └── services/            (business logic, Fast2SMS/Supabase/Gemini integrations)
│   ├── alembic/versions/        (7 migrations)
│   ├── tests/                   (161 tests at last run — see §39)
│   ├── requirements.txt / Dockerfile / docker-compose.yml / .env.example
└── docs/
    └── archive/                 ← superseded pre-migration docs, kept for history only
```

## 10. Emergency Flow

`EmergencyCoordinator.triggerEmergency()` creates the event and persists it locally in one call —
synchronously as far as every other subsystem is concerned. `EmergencyLocationController`,
`EvidenceController`, and the sync layer each independently observe the coordinator
(`subscribeActiveEvent`) and react; none of them can delay the trigger. Resolving/cancelling an
emergency follows the same observer pattern in reverse.

## 11. Voice Architecture

Always-on, ARM-independent hotword detection via a foreground Android service
(`VoiceDetectionService.kt`) running Vosk (offline, on-device) against a small fixed grammar of
approved SOS phrases (`VoicePhraseCatalog.kt`). A match of sufficient word confidence
(`VoiceKeywordMatcher.kt`) triggers the emergency directly through `EmergencyCoordinator` — no
network, no cloud speech API, on the emergency path. **IMPLEMENTED**, automated-tested, and
physically validated during Phase A hardening.

## 12. Shake Architecture

Shake detection only runs while Protection Mode (ARM) is `ACTIVE`. Hardened to require **3
deliberate peaks** within a bounded window (`ShakePeakAnalyzer.kt`: magnitude ≥ 2.2g, ≥120ms
apart, within a 1.2s window, 4s cooldown) to reject incidental jostling. **IMPLEMENTED**,
automated-tested, physically validated.

## 13. Location

`LocationService` wraps the native Android location APIs; `EmergencyLocationController` snapshots
a best-available fix the instant an emergency opens (no GPS wait) and then streams updates for the
duration. Points are queued locally and uploaded by `LocationSyncQueue`, which never blocks on a
stuck emergency (one event's sync failure doesn't starve others — a real bug found and fixed
during physical testing). **IMPLEMENTED**, automated-tested, physically validated.

## 14. Route Safety

Session-based: plan a route, the backend notifies trusted contacts immediately, and
`RouteDeviationDetector` (pure state machine, 125m threshold, 45s confirmation) runs client-side
to detect departures from the planned route, dispatching a deviation alert through the same
backend path. **IMPLEMENTED** and unit-tested.
**PARTIAL / NOT VERIFIED end-to-end**: the real route geometry depends on the Google Routes API,
which currently returns `API_KEY_ANDROID_APP_BLOCKED` despite a correctly-configured Android
app-restricted key (SHA-1 fingerprint fix applied and confirmed exact-match; root cause appears to
be on the Google Cloud Console / API-propagation side, not the app). Deferred per explicit
instruction to leave it for now.

## 15. Safe Locations / Hospitals / Police / Fire

Built on `SafeLocationsService` + the Google Places API, which shares the same blocked-key issue
as §14. **PARTIAL / NOT VERIFIED** — code complete, blocked by the same external API issue.

## 16. Live Location

`LiveLocationScreen` visualizes the current location layer and opens it in Google Maps.
**IMPLEMENTED**, automated-tested.

## 17. Derouting

See §14 — the deviation state machine itself is **IMPLEMENTED** and unit-tested independent of
Google Maps; the live, physically-observed end-to-end flow is **NOT VERIFIED** because it needs
real route geometry from the currently-blocked Places/Routes API.

## 18. Trusted Contacts

Server-owned (`TrustedContact` model, max 10 total / 5 active, priority-ordered), managed from the
app via `ContactsRepository`/`TrustedContactsScreen`. **IMPLEMENTED**, automated-tested, used
throughout physical testing this session.

## 19. Real Fast2SMS

The Fast2SMS provider (`app/services/fast2sms_provider.py`) is a complete, correct implementation:
normalizes Indian phone numbers, posts to the Fast2SMS `bulkV2` endpoint, and maps the response
truthfully to `PROVIDER_ACCEPTED` (never fabricates `DELIVERED` — Fast2SMS's bulkV2 route gives no
delivery receipt). Switching modes is a single environment variable
(`COMMUNICATION_PROVIDER_MODE=real` + `SMS_PROVIDER=fast2sms` + `FAST2SMS_API_KEY=<key>`) — no code
change, and `render.yaml` sets `COMMUNICATION_PROVIDER_MODE=real` as the production default.
**IMPLEMENTED** and code-complete. **No real SMS was sent this session** — the controlled test
described in the original task required a real phone number, and the user explicitly chose to
defer that to their own testing rather than have the assistant pick one. See §40.

## 20. Evidence

Audio evidence records automatically for the duration of an open emergency
(`EvidenceController` + `EvidenceRecorderModule.kt`, MediaRecorder/AAC), independent of the always-on
voice hotword mic (the two are mutually-exclusive consumers; voice pauses while evidence records).
**IMPLEMENTED**, automated-tested, physically validated (a real device test recorded a 7-minute
clip). Playback (native `MediaPlayer`) and download (native `MediaStore` → public Downloads, with
a cloud-signed-URL fallback if the local file is gone) were added this session.
**NOT VERIFIED physically yet** (automated-tested; the device-test request was superseded by the
Settings redesign before confirmation came back).

## 21. Cloud Evidence

`EvidenceSyncQueue` uploads recorded files to a private Supabase Storage bucket via
`supabase_storage.py` (plain `httpx` REST calls, not the official SDK). A real device test found
and fixed a genuine bug: the native recorder returned a bare filesystem path with no `file://`
scheme, which Android's networking layer couldn't resolve — fixed in
`EvidenceUploadTransport.ts`. **IMPLEMENTED**, automated-tested (backend 161/161, a dedicated
regression test added for the exact bug above). **NOT VERIFIED** with a full clean device retest
after the fix (backend upload path was verified directly via curl, not via the app end-to-end).

## 22. PDF Reports

`pdf_report_service.py` (reportlab) builds a PDF from real event/location/communication/evidence
rows — nothing fabricated, missing data is labelled missing. Uploaded to Supabase alongside audio.
A "Download PDF Report" button in History → Incident Details generates and downloads it.
**IMPLEMENTED**, automated-tested. **NOT VERIFIED** on a physical device yet (same reason as §20).

## 23. Five-Minute Evidence Workflow

`EvidenceDeliveryController` fires exactly once, 5 minutes after an emergency opens (timer based
on the emergency's real open time, so it survives app restarts near the boundary), calling
`POST /evidence/{eventId}/deliver`. That endpoint is atomically idempotent (claimed via a
`WHERE … IS NULL` update before any provider call) and sends one SMS per active trusted contact
with secure report/audio links. **IMPLEMENTED**, automated-tested (idempotency explicitly
covered). **NOT VERIFIED** end-to-end on a physical device with a real 5-minute wait and a
configured contact.

## 24. Ask SheGuard

A chat UI (`AskSheGuardScreen.tsx`) that relays messages to the backend, which calls Gemini with a
safety-focused system prompt and immediate-danger phrase detection (a canned SOS-banner response
for phrases like "being attacked" — this never touches `EmergencyCoordinator`, it's a UI nudge
toward the real SOS button only). **IMPLEMENTED**, automated-tested, and verified working via a
direct backend call this session after a model-name fix (see §25).

## 25. Gemini

Server-side only (`GEMINI_API_KEY`, never sent to the app). The originally-coded model
(`gemini-1.5-flash`) is fully retired by Google; `gemini-2.5-flash` is also retired for new
callers; `gemini-3.8-flash` works but took ~38s for a one-word reply (unusable for a chat UI). The
backend now uses **`gemini-3.1-flash-lite`**, verified at ~1.3s for a real safety-tip reply with
full chat history and the system prompt. **IMPLEMENTED** and verified.

## 26. Voice Ask SheGuard

A one-shot speech-to-text module (`AskVoiceInputModule.kt`, Android's built-in `SpeechRecognizer`
— free, on-device dictation, no extra API key) wired to a mic button in the chat screen; pauses
the voice-SOS hotword listener for the duration (same mutual-exclusion rule as evidence
recording). The transcript fills the text box — it is never auto-sent, so a misheard phrase can't
be sent by accident. **IMPLEMENTED**, automated-tested. **NOT VERIFIED** on a physical device.

## 27. Authentication

Phone + password registration/login, JWT access + refresh tokens, device binding, single-flight
refresh-on-401 with one retry (never loops). **IMPLEMENTED**, extensively automated-tested.

## 28. Offline Behaviour

The entire emergency trigger path (Manual SOS, Voice, Shake) and location/evidence capture work
with zero network connectivity — this is the core design principle, not an afterthought. Server
sync is best-effort and resumes automatically on reconnect
(`__tests__/sync/SafetyInvariantTest.test.ts`). **IMPLEMENTED**, extensively tested.

## 29. Database

PostgreSQL in production (SQLite for local dev). Current tables (via Alembic, 7 migrations):
`users`, `devices`, `refresh_sessions`, `trusted_contacts`, `emergency_events`,
`emergency_locations`, `emergency_communication_logs`, `route_safety_sessions`,
`route_safety_communication_logs`, `evidence_items`, `incident_reports`,
`evidence_delivery_logs`. See §37.

## 30. API

Base path `/api/v1`. Route groups: `health`, `auth`, `emergencies`, `contacts`, `communication`,
`locations`, `ask`, `route-safety`, `evidence`. The exact, always-current request/response schemas
are served live by FastAPI itself at `/api/v1/docs` (Swagger) and `/api/v1/redoc` — deliberately
not duplicated into a hand-maintained document that can drift out of date (an old,
now-archived copy is at `docs/archive/API_CONTRACT.old.md` for historical reference only).

## 31. Environment Variables

See `backend/.env.example` for the full, current list with inline explanations. Summary:

| Variable | Secret? | Purpose |
|---|---|---|
| `DATABASE_URL` | yes (contains credentials) | Postgres connection string |
| `JWT_SECRET` | yes | Access/refresh token signing |
| `COMMUNICATION_PROVIDER_MODE` | no | `mock` or `real` SMS |
| `SMS_PROVIDER` | no | `fast2sms` or `mock` |
| `FAST2SMS_API_KEY` | **yes** | Real SMS sending |
| `SUPABASE_URL` / `SUPABASE_BUCKET` | no | Not secret — project identifiers |
| `SUPABASE_SECRET_KEY` | **yes** | Service-role key, server-only |
| `GEMINI_API_KEY` | **yes** | Ask SheGuard AI replies |
| `ROUTE_SAFETY_LIVE_BASE_URL` | no | Must be the real deployed backend URL in production |
| `CORS_ORIGINS` | no | Comma-separated, or `*` |
| `PORT` | no | Set automatically by Render |

## 32. Local Setup (React Native)

```bash
npm install
npx tsc --noEmit        # TypeScript check
npm test                # Jest
npm run android         # requires an emulator/device + the backend reachable (see §34 config)
```

## 33. Backend Setup

```bash
cd backend
python -m venv venv && source venv/Scripts/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env    # fill in real secrets locally; never commit .env
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Or via Docker: `docker compose up --build` (see `backend/docker-compose.yml`).

## 34. Android Setup

Requires `android/local.properties` → actually `local.properties` at the repo root (Android
Studio-generated, git-ignored) with `sdk.dir=<your Android SDK path>` and
`MAPS_API_KEY=<your Google Maps/Places key, restricted to this app's package + SHA-1>`. The build
reads it from there or the `MAPS_API_KEY` environment variable — never hardcoded
(`app/build.gradle.kts`). Set the backend URL for the mobile app in
`src/api/apiConfig.ts` (`DEV_API_BASE_URL` for local dev via `adb reverse`, `RELEASE_API_BASE_URL`
for the deployed Render URL — must be `https://`).

```bash
./gradlew assembleDebug      # or assembleRelease
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 35. Testing

```bash
npx tsc --noEmit                      # TypeScript
npm test                              # Jest (React Native)
cd backend && venv/Scripts/python.exe -m pytest -q   # Backend
```
See §39 for the exact counts from the last run in this session.

## 36. Render Deployment

1. Push this repository to GitHub.
2. In Render: **New → Blueprint**, point it at the repo — `render.yaml` at the repo root defines
   the `sheguard-ai-backend` web service (root directory `backend/`) and a managed
   `sheguard-ai-db` Postgres database.
3. Render will prompt for the env vars marked `sync: false` in `render.yaml`:
   `FAST2SMS_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_SECRET_KEY`. Set them in the Render dashboard —
   never in the blueprint file.
4. Build command (from `render.yaml`): `pip install -r requirements.txt && alembic upgrade head`.
   Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
5. Health check path: `/api/v1/health/live`.
6. After the first deploy, note the actual assigned URL (Render may suffix it if
   `sheguard-ai-backend` is taken) and update `ROUTE_SAFETY_LIVE_BASE_URL` in the Render dashboard
   and `RELEASE_API_BASE_URL` in `src/api/apiConfig.ts` to match.
7. This was **not** actually deployed to Render this session — the blueprint and backend are
   prepared and verified locally (health, CORS, `$PORT` binding, migrations), but no live Render
   service exists yet to point at. See §41.

## 37. Supabase Storage Setup

Project: `https://iulrqqygrnbzoqkpwciu.supabase.co`, bucket `sheguard-evidence`, **private**. The
backend uploads/signs URLs with the service-role key (`SUPABASE_SECRET_KEY`, server-only); the app
never talks to Supabase directly. No new bucket was created — the existing one is reused as
instructed.

## 38. Google Maps/Places Configuration

The Android app needs a Maps/Places API key in `local.properties` (or `MAPS_API_KEY` env var),
restricted in Google Cloud Console to this app's package name (`com.sheguardai.app`) and release
signing SHA-1. **Current known issue**: the Routes/Places calls return
`API_KEY_ANDROID_APP_BLOCKED` even with a verified-correct restriction and fingerprint; this is
parked per explicit instruction (see §14).

## 39. Fast2SMS Configuration

Sign up at Fast2SMS, get an API key, set `FAST2SMS_API_KEY` (and `COMMUNICATION_PROVIDER_MODE=real`)
in the environment. See §19 for the truthful-status guarantee and §40 for this session's test
status.

## 40. Security

- No API key, password, or secret is hardcoded in any tracked source file (scanned this session —
  none found).
- `local.properties` (Maps key) and `backend/.env` (all server secrets) are git-ignored.
- Supabase bucket is private; files are only reachable via time-limited signed URLs generated
  server-side.
- Every evidence/report/route-safety/location endpoint enforces per-user ownership
  (`_load_owned_event` and equivalents) — a cross-user access attempt gets 404, not 403 (resource
  existence isn't leaked either).
- JWT access tokens are short-lived (15 min) with single-flight refresh.

## 41. Safety Invariants

See §5. Enforced by dedicated tests: `SafetyInvariantTest`, `SingleOpenEmergencyInvariantTest`,
`EmergencyCoordinatorTest`, and the local-first design of every controller that observes
`EmergencyCoordinator` rather than gating it.

## 42. Known Limitations

- Google Routes/Places API blocked (`API_KEY_ANDROID_APP_BLOCKED`) — Route Safety's real geometry,
  Safe Locations, and physically-verified derouting are blocked on this (§14/§15/§17).
- Hardware button trigger is an unimplemented placeholder (`HardwareButtonActivationAdapter.ts`
  explicitly says so in its own comment) — not wired to any real OS-level key intercept.
- Threat Analysis and Alarm/Siren are not implemented (explicitly deferred in an earlier phase).
- Real Fast2SMS mode is code-complete but has not been exercised with an actual send this session.
- Evidence playback/download and the five-minute delivery workflow are automated-tested but not
  yet physically re-confirmed after their most recent fixes.
- Location retention-after-close (documented target: 90 days) has no enforcement/purge job yet.
- No Render deployment actually exists yet — see §41.

## 43. Roadmap

Hardware trigger, Threat Analysis, Alarm/Siren, resolving the Google API key block, a physical
end-to-end pass on evidence/report/delivery and voice Ask SheGuard, and an actual Render deploy.

## 44. Contribution

Internal project; no external contribution process defined yet.

## 45. License

No `LICENSE` file exists in this repository. **LICENSE DECISION REQUIRED** — not invented here;
choose one (e.g. MIT, Apache-2.0, or proprietary/all-rights-reserved) before any public release.
