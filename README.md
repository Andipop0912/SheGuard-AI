# SheGuard AI

**Smarter Safety**

A personal safety app for women: bare React Native (Android) + a FastAPI backend, built
local-first so every emergency action works instantly and offline, with the backend, Google
services and AI as enhancements — never as a dependency for safety.

> **Status legend used throughout this document:** ✅ **Implemented** (built, automated-tested),
> ⚠️ **Partial / requires external configuration** (code complete, depends on a manual Google
> Cloud / Supabase / Fast2SMS / signing step this repo cannot perform on its own), ⏸ **Deferred**
> (intentionally not built). Nothing below is marked done unless it actually is.

---

## 1. Overview

SheGuard AI lets a user trigger an emergency instantly (button, shake, or voice), captures their
location and audio evidence, alerts trusted contacts by SMS, plans a monitored route with nearby
police/hospital locations, and offers an AI safety assistant — all built so the core emergency
path never waits on a network call, a server, or an AI model.

This app does not guarantee protection, does not prevent crime, does not replace emergency
services, and its AI assistant does not detect threats on its own — it is a communication and
information tool. The red SOS button and local emergency number dialing remain the primary path
for actual danger.

## 2. Problem Statement

Personal-safety apps often fail at the moment they're needed most: they wait on a network call, a
permission dialog, or a slow backend before anything actually happens. SheGuard AI inverts that —
the phone acts first, and everything else (sync, SMS, route geometry, AI) happens alongside or
after, never as a gate.

## 3. Vision

A safety app a user can trust to work in a basement with no signal, a crowded train with a spotty
connection, or a new phone they just signed into — because the emergency path never depends on any
of that.

## 4. Core Safety Principles

1. **Emergency-first execution** — pressing SOS (or a valid voice/shake trigger) creates the
   emergency synchronously, before any other subsystem is consulted.
2. **Local-first persistence** — the event is written to on-device storage immediately; the
   server copy is a backup, not the source of truth for the device's own behavior.
3. **Network independence for critical emergency creation** — Manual SOS, Voice SOS, and the
   underlying trigger machinery never await GPS, the backend, or Gemini.
4. **AI must never block SOS** — Ask SheGuard is a separate screen with its own, independently
   timed-out backend call; it has no code path into `EmergencyCoordinator`.
5. **`EmergencyCoordinator` is the single local emergency-creation authority** — every trigger
   source (manual, voice, shake) calls into it; nothing else creates or ends an emergency.
6. **Additional triggers attach to the existing emergency** — a second trigger while one is
   already open joins it rather than creating a duplicate (enforced: only one open emergency per
   device at a time).
7. **Background/resource-conscious operation** — bounded Google Places sampling, throttled
   location sync, single-microphone-ownership rules, and a single composition root
   (`AppContainer`) so nothing is instantiated twice.
8. **Privacy-conscious data handling** — SMS and AI payloads carry only what's needed (no auth
   tokens, no raw internal database IDs, no unnecessary location history); Supabase evidence is
   private with ownership-checked, time-limited signed URLs.
9. **No fake/mock production safety data** — Route Safety never fabricates a route or a nearby
   police station; a failed Google call surfaces as a truthful error, never invented content.
10. **Explicit distinction between implemented and planned functionality** — see §22–25 below;
    nothing is called "done" here unless the code backing it actually exists and was tested.

## 5. Key Features

| Feature | Status |
|---|---|
| Manual SOS | ✅ Implemented |
| Voice SOS (Vosk, offline hotword) | ✅ Implemented |
| Shake SOS (ARM-gated) | ✅ Implemented |
| Protection Mode (ARM) | ✅ Implemented |
| `EmergencyCoordinator` / single-open-emergency invariant | ✅ Implemented |
| Emergency location capture & sync | ✅ Implemented |
| Live Location screen | ✅ Implemented |
| Route Safety (real Google route, corridor-sampled safe locations, deviation detection) | ⚠️ Code complete — requires Google Cloud configuration (§23) |
| Route sharing / live tracking link to trusted contacts | ✅ Implemented |
| Trusted contacts (max 10 stored / 5 active) | ✅ Implemented |
| Fast2SMS real-mode dispatch | ⚠️ Code complete — requires a funded production key (§23) |
| Evidence recording / playback / download | ✅ Implemented |
| Evidence upload queue (retry, offline-safe) | ✅ Implemented |
| Supabase private storage + signed URLs | ⚠️ Code complete — requires the real server-side Supabase secret (§23) |
| Incident PDF report | ✅ Implemented |
| Five-minute evidence delivery (idempotent) | ✅ Implemented |
| Ask SheGuard — text | ✅ Implemented |
| Ask SheGuard — voice input (Android SpeechRecognizer) | ✅ Implemented |
| Authentication (phone + password, JWT, device binding) | ✅ Implemented |
| Offline-first local operation / background sync | ✅ Implemented |
| Legal / Emergency Help (verified helplines, offline) | ✅ Implemented |
| Official SheGuard branding (launcher, splash, in-app identity) | ✅ Implemented |
| Standalone Android release build (no Metro dependency) | ⚠️ Architecture in place — requires a real release keystore to be production-signed (§23) |
| Hardware button trigger | ⏸ Placeholder only (§25) |
| Threat Analysis | ⏸ Deferred |
| Alarm / Siren | ⏸ Deferred |

## 6. System Architecture

```
Manual SOS / Shake / Voice          (Hardware trigger — placeholder, not wired)
        │
        ▼
EmergencyCoordinator   ← single authority for emergency lifecycle
        │                (one open emergency at a time; local-first)
   ┌────┼─────────────────┬──────────────────┐
   ▼    ▼                 ▼                  ▼
Location  Evidence   Server sync      Trusted-contact
capture   recording  (when connected)  SMS dispatch (Fast2SMS)
```

The mobile app is layered and dependency-injected: `domain` (pure types/state machines) →
`services`/`store` (Zustand, observes domain services) → `native` (thin bridges to Kotlin modules)
→ `features` (screens), composed once in `src/app/di/AppContainer.ts`. Nothing upstream of
`EmergencyCoordinator` can block it; everything downstream (location, evidence, sync, Route
Safety, delivery) subscribes to it and reacts asynchronously.

The backend is a standard FastAPI layering: `api/v1` (routers) → `services` (business logic) →
`db/models` (SQLAlchemy) with Pydantic `schemas` for request/response contracts.

## 7. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Mobile UI | React Native 0.76.5 (bare), TypeScript | App shell, screens |
| State | Zustand | UI-facing state, backed by domain services |
| Navigation | React Navigation | Stack/tab navigation |
| Android native | Kotlin | Foreground services, recorder/player, native bridges |
| Emergency speech detection | Vosk (offline, on-device) | Background SOS hotword |
| Ask SheGuard voice | Android `SpeechRecognizer` | One-shot chat dictation |
| Backend | FastAPI (Python 3.12) | REST API |
| Database | PostgreSQL (SQLite for local dev) | Persistence |
| Migrations | Alembic | Schema versioning |
| AI | Google Gemini, called server-side only | Ask SheGuard replies |
| Routing | Google Routes API | Route Safety geometry |
| Places | Google Places API (New) | Nearby police/hospital/fire discovery |
| Storage | Supabase Storage (private bucket) | Evidence audio + incident PDFs |
| SMS | Fast2SMS | Trusted-contact alerts |
| Deployment | Render | Backend hosting + managed Postgres |
| Testing | Jest, pytest, `tsc --noEmit`, Android `testDebugUnitTest` | Automated verification |

**Not used** — do not reintroduce without a deliberate architecture decision: Expo, Firebase,
Firestore, Flutter, TFLite.

## 8. Project Structure

```
CodeBase/
├── src/                          ← React Native (TypeScript)
│   ├── api/                      API client, DTOs, apiConfig.ts
│   ├── app/                      bootstrap, di (AppContainer)
│   ├── activation/                ARM / trigger adapters (manual, voice, shake, hardware-placeholder)
│   ├── emergency/                 EmergencyCoordinator, domain, storage, sync
│   ├── location/                  LocationService, sync queue
│   ├── evidence/                  recording controller, upload queue, repository
│   ├── routesafety/                session controller, deviation detector, safe locations
│   ├── features/
│   │   ├── ask/                   AskSheGuardScreen
│   │   ├── auth/                  Sign In / Register
│   │   ├── home/                  HomeScreen (floating Ask SheGuard button)
│   │   ├── settings/ help/ ...
│   │   └── routesafety/           RouteSafetyScreen
│   ├── design/                    tokens, Icon, Wordmark, shared components, assets
│   ├── contacts/ communication/ auth/ helplines/ history/ sync/
├── app/                           ← Android/Kotlin native project
│   └── src/main/java/com/sheguardai/app/
│       ├── activation/ ask/ config/ evidence/ location/ routesafety/ voice/ ...
├── backend/                       ← FastAPI backend
│   ├── app/
│   │   ├── api/v1/                health, auth, emergencies, contacts, communication,
│   │   │                          locations, ask, route_safety, evidence
│   │   ├── core/                  config, security, dependencies
│   │   ├── db/models/             SQLAlchemy models
│   │   ├── schemas/                Pydantic contracts
│   │   └── services/                business logic (Fast2SMS/Supabase/Gemini/PDF)
│   ├── alembic/versions/
│   ├── tests/
│   └── requirements.txt / Dockerfile / docker-compose.yml / .env.example
├── __tests__/                     ← Jest
├── package.json / render.yaml / README.md
└── docs/archive/                  ← superseded pre-migration docs, historical only
```

## 9. Emergency / Trigger Architecture

```
Manual:  User → EmergencyCoordinator                       (no ARM required)
Voice:   Vosk (offline hotword) → phrase match → EmergencyCoordinator   (no ARM required)
Shake:   Accelerometer → 3-peak pattern analysis → ARM must be ACTIVE → EmergencyCoordinator
Hardware: placeholder adapter only — not wired to any OS-level key intercept
```

- Manual SOS does **not** require ARM/Protection Mode.
- Voice SOS does **not** require ARM/Protection Mode.
- Shake is the only trigger gated by ARM (`ShakePeakAnalyzer`: ≥2.2g peaks, ≥120ms apart, within
  a 1.2s window, 4s cooldown — rejects incidental jostling).
- `HardwareButtonActivationAdapter.ts` exists but its own source comment states it is a
  "Placeholder for future hardware-button integration" — it is not implemented.

## 10. Voice Architecture

Two separate, intentionally non-interchangeable systems:

- **Emergency voice** (`VoiceDetectionService.kt`): always-on, ARM-independent, offline Vosk
  hotword detection against a small fixed phrase grammar, running as a foreground service. No
  network, no cloud speech API, on the emergency path.
- **Ask SheGuard voice** (`AskVoiceInputModule.kt`): one-shot, user-initiated dictation via
  Android's built-in `SpeechRecognizer`, used only while the chat screen is open. It pauses the
  Vosk hotword listener for its duration and resumes it afterward (only one microphone consumer
  at a time) — it never disables emergency voice detection permanently.

## 11. Route Safety

```
Current location → destination text → Google Places text search (resolve destination)
   → Google Routes API (real polyline, distance, duration)
   → Route Safety session created locally + on the backend
   → trusted contacts notified immediately with a live-tracking link
   → live location tracking (reuses the same tracking toggle as emergency location)
   → safe-location discovery along the route corridor
   → client-side deviation detection
```

Safe-location discovery is **bounded**, not unlimited: the route is sampled at a small number of
representative points (1 point for routes under 2km, scaling up to a fixed cap for longer routes),
Google Places (New) is queried once per point per category (hospital / police / fire station),
results are deduplicated by Google place ID, filtered to a 500m corridor around the route, and
sorted by distance-ahead. Each result reports both how far **ahead along the route** it is and how
far **from the route** it sits — never a single ambiguous number.

Deviation detection (`RouteDeviationDetector.ts`) is a pure client-side state machine: 125m
threshold, 45 seconds of continuous deviation before a deviation is confirmed, resets back to
on-route if the user returns within 15 seconds, and sends exactly one guardian notification per
deviation episode — tracking continues afterward, and it never creates or touches an emergency.

## 12. Ask SheGuard AI

```
Home floating assistant button → AskSheGuardScreen
   → authenticated POST /api/v1/ask → ask_service.py (server-side)
   → Gemini (GEMINI_API_KEY, never sent to the client)
   → controlled response → UI
```

- The Gemini key never leaves the server; the mobile app only ever calls the authenticated
  `/api/v1/ask` endpoint through the same `ApiClient`/Bearer-token system used everywhere else.
- Text chat and one-shot voice dictation (Android `SpeechRecognizer`) both feed the same endpoint.
- A server-side timeout converts a slow/hung Gemini response into a controlled, retryable error
  rather than hanging the UI; offline/network failure is reported truthfully ("needs an internet
  connection"), never faked.
- Ask SheGuard never creates, cancels, or delays an emergency — it has no reference to
  `EmergencyCoordinator`. An immediate-danger phrase gets a canned response pointing at the real
  SOS button; it never claims an action (like notifying emergency services) that the app did not
  actually perform.
- There is no offline/on-device Gemini inference — AI replies require network connectivity.

## 13. Evidence & Emergency Communication

```
Emergency opens → local audio recording (MediaRecorder, app-private storage)
   → metadata persisted locally (LOCAL_ONLY)
   → upload queue (retry with backoff, offline-safe)
   → FastAPI → private Supabase bucket (signed URL, ownership-checked)
   → incident PDF report (built from real stored rows only)
   → five-minute delivery workflow → trusted contacts via Fast2SMS
```

- The local recording is the source of truth: a failed cloud upload never deletes it, only
  changes its sync status, and upload automatically retries (with backoff) and resumes on the
  next sign-in/app start.
- Every evidence/report endpoint checks the requesting user owns the event and the evidence item
  before doing anything — cross-user access is rejected.
- The Supabase bucket is private; signed URLs are generated server-side, only after the ownership
  check, with a finite TTL (`SUPABASE_SIGNED_URL_TTL_SECONDS`).
- The five-minute delivery call is idempotent at the database level (an atomic
  `UPDATE ... WHERE evidence_delivered_at IS NULL` claim) — a retried or duplicate trigger is
  always a safe no-op. A PDF-generation failure is isolated so it cannot block the SMS
  notification to trusted contacts.
- Fast2SMS **acceptance is not delivery**: the system distinguishes `PROVIDER_ACCEPTED` from
  `DELIVERED` and never displays "delivered" unless the provider actually confirms it (Fast2SMS's
  `bulkV2` route currently gives no delivery receipt, so the UI shows "Accepted by SMS provider").

## 14. Authentication & Security

- Phone + password registration/login; passwords hashed with bcrypt (`passlib`).
- JWT access tokens (short-lived) + refresh tokens, stored server-side only as a hash
  (`hash_token`), rotated on every refresh call.
- Device binding: each session is tied to a `device_id` recorded at login/registration.
- Every resource endpoint (emergencies, locations, contacts, evidence, route safety) filters by
  the authenticated user's own ID — no cross-user access.
- Route Safety live-share tokens are unguessable (`secrets.token_urlsafe(24)`), never the raw
  session ID.
- Supabase bucket is private; service credentials and signed-URL generation are server-only.
- All secrets (Gemini, Fast2SMS, Supabase, JWT, Maps) are read from environment variables, never
  hardcoded, and the Google Maps/Places/Routes key is restricted to this Android app's package +
  signing certificate.
- The production API is HTTPS-only (`https://sheguard-ai-q4k1.onrender.com/api/v1`).

## 15. Offline / Local-First Behavior

**Works without internet:**
- Emergency creation (Manual / Voice / Shake) and local persistence
- Local audio recording, playback, and download of already-local evidence
- Vosk emergency voice detection (wherever the OS grants the foreground-service/mic permissions)
- Shake detection
- Legal Help screen and its verified helpline numbers/dialer handoff

**Requires network:**
- Backend sync of emergencies/locations/evidence
- Ask SheGuard (Gemini) responses
- Google Routes/Places calls (route geometry, nearby safe locations)
- Trusted-contact live-sharing and deviation notifications
- Supabase upload / signed-URL generation
- Fast2SMS dispatch

## 16. Backend API

Base path `/api/v1`. Route groups: `health`, `auth`, `emergencies`, `contacts`, `communication`,
`locations`, `ask`, `route-safety`, `evidence`. The exact, always-current request/response schemas
are served live by FastAPI at `/api/v1/docs` (Swagger) and `/api/v1/redoc` — not duplicated into a
hand-maintained contract document that can drift (a historical one is archived at
`docs/archive/API_CONTRACT.old.md`).

Health endpoints: `GET /api/v1/health/live`, `GET /api/v1/health/ready`.

## 17. Environment Configuration

See `backend/.env.example` for the full current list with inline explanations. Set every secret
through environment/Render configuration — never commit a real value.

| Variable | Secret? | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `JWT_SECRET` | yes | Access/refresh token signing |
| `COMMUNICATION_PROVIDER_MODE` | no | `mock` or `real` SMS |
| `SMS_PROVIDER` | no | `fast2sms` or `mock` |
| `FAST2SMS_API_KEY` | **yes** | Real SMS sending |
| `SUPABASE_URL` / `SUPABASE_BUCKET` | no | Project identifiers, not secret |
| `SUPABASE_SECRET_KEY` | **yes** | Service-role key — server-only, must never be a publishable key |
| `GEMINI_API_KEY` | **yes** | Ask SheGuard AI replies |
| `ROUTE_SAFETY_LIVE_BASE_URL` | no | Must be the real deployed backend URL in production |
| `CORS_ORIGINS` | no | Comma-separated, or `*` |
| `PORT` | no | Set automatically by Render |

Mobile/Android: `MAPS_API_KEY` in git-ignored `local.properties` (or the `MAPS_API_KEY` env var) —
a Google Maps/Places/Routes key restricted to this app's package + signing certificate, never
hardcoded in source.

## 18. Local Development Setup

### A. React Native / Android

```bash
npm install
npx tsc --noEmit        # TypeScript check
npm test                # Jest
npm run android          # requires an emulator/device + a reachable backend
```

Requires `local.properties` at the repo root (Android Studio-generated, git-ignored):
`sdk.dir=<your Android SDK path>` and `MAPS_API_KEY=<your key>`.

### B. Backend

```bash
cd backend
python -m venv venv && venv\Scripts\activate     # Windows
pip install -r requirements.txt
copy .env.example .env    # fill in real secrets locally; never commit .env
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Or via Docker: `docker compose up --build` (`backend/docker-compose.yml`). Requires Python 3.12
(see `backend/Dockerfile`) and PostgreSQL if testing against Postgres locally (SQLite works for
basic local dev).

### C. Optional external services

Google Cloud (Routes API, Places API (New)), Supabase project, and a Fast2SMS account are only
needed to exercise Route Safety, evidence cloud storage, and real SMS respectively — the rest of
the app (emergency core, local evidence, authentication) works without them.

## 19. Android Build / Run

```bash
./gradlew assembleDebug        # or assembleRelease
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

- `applicationId` is `com.sheguardai.app`. The unrelated `com.sheguard.app` package is not part of
  this project.
- The release build bundles the JS and Hermes bytecode; it does not require Metro to run — Metro
  is a development-only concern (`npx react-native start`).
- **Release signing**: `app/build.gradle.kts` reads release credentials from a git-ignored
  `app/signing.properties` (copy from `app/signing.properties.example`) or
  `SHEGUARD_RELEASE_STORE_FILE` / `SHEGUARD_RELEASE_STORE_PASSWORD` / `SHEGUARD_RELEASE_KEY_ALIAS`
  / `SHEGUARD_RELEASE_KEY_PASSWORD` environment variables. **As of this writing, no real release
  keystore has been provided**, so `assembleRelease` falls back to debug signing (with a build
  warning) — this produces a locally-installable test APK, not a production-signed artifact.
  Create a real one with:
  ```bash
  keytool -genkeypair -v -keystore app/sheguard-release.keystore -alias sheguard-release \
    -keyalg RSA -keysize 2048 -validity 10000
  ```

### Java/Gradle toolchain

The app compiles against Java 17 (`compileOptions`/`kotlinOptions`). Gradle (8.10.2, matching this
project's Kotlin Gradle plugin version) just needs to be *launched* by a JDK whose version string
it can parse — any JDK 17–23 on `PATH`/`JAVA_HOME` works; nothing is hardcoded in the repo. If a
very new JDK (24/25) is the launching JVM, or a stale background daemon was started under one
(commonly caused by IDE tooling bundling its own JRE), stop daemons (`./gradlew --stop`) and kill
any lingering `KotlinCompileDaemon`/`GradleDaemon` processes before rebuilding.

## 20. Testing

```bash
npx tsc --noEmit                                      # TypeScript
npm test -- --runInBand                                # Jest
cd backend && venv\Scripts\python.exe -m pytest -q     # Backend
./gradlew :app:testDebugUnitTest --no-parallel --max-workers=1   # Android unit tests
```

**Most recent verified results:**

| Suite | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | 0 errors |
| Jest | 45/45 suites, 408/408 tests passed |
| Backend (pytest) | 161 passed, 2 skipped |
| Android unit tests / debug & release build / physical-device validation | Part of manual release validation — not completed in this repository context at the time of writing |

Do not treat the project as fully release-validated until the Android/device steps above are
actually run and recorded.

## 21. Production Deployment

Backend: `https://sheguard-ai-q4k1.onrender.com`, API base
`https://sheguard-ai-q4k1.onrender.com/api/v1`. Health checks:
`GET /api/v1/health/live`, `GET /api/v1/health/ready`.

Per `render.yaml`: build command `pip install -r requirements.txt && alembic upgrade head`; start
command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`; a managed `sheguard-ai-db` Postgres
database. Secrets marked `sync: false` in `render.yaml` (`FAST2SMS_API_KEY`, `GEMINI_API_KEY`,
`SUPABASE_SECRET_KEY`) must be set directly in the Render dashboard — never in the blueprint file.

## 22. Current Implementation Status

| Feature | Status | Notes |
|---|---|---|
| Manual SOS | ✅ Implemented | No ARM required |
| Voice SOS | ✅ Implemented | Offline Vosk, no ARM required |
| Shake SOS | ✅ Implemented | ARM-gated, 3-peak pattern |
| Hardware Trigger | ⏸ Placeholder | Adapter exists, not wired to any OS key intercept |
| `EmergencyCoordinator` / single-open-emergency | ✅ Implemented | Automated-tested |
| Emergency location capture & sync | ✅ Implemented | |
| Route Safety (route/safe-locations/deviation) | ⚠️ Code complete | Requires Google Cloud Routes/Places configuration to verify live |
| Trusted contacts | ✅ Implemented | Max 10 stored / 5 active |
| Fast2SMS real mode | ⚠️ Code complete | Requires a funded production key; no real send performed |
| Evidence recording/playback/download/upload | ✅ Implemented | Local-first, retrying upload queue |
| Supabase evidence/report storage | ⚠️ Code complete | Requires the real server-side Supabase secret in deployment |
| Incident PDF report | ✅ Implemented | |
| Five-minute evidence delivery | ✅ Implemented | Idempotent |
| Ask SheGuard (text + voice) | ✅ Implemented | Server-side Gemini |
| Authentication | ✅ Implemented | JWT + device binding |
| Offline-first core / background sync | ✅ Implemented | |
| Official branding (launcher/splash/in-app) | ✅ Implemented | |
| Release signing | ⚠️ Architecture ready | Requires a real release keystore |
| Threat Analysis | ⏸ Deferred | Not active |
| Alarm / Siren | ⏸ Deferred | Not active |

## 23. External Configuration Requirements

**Google Cloud (Routes API / Places API (New)):**
- Enable Routes API and Places API (New) for the project (Geocoding API is not needed — the app
  resolves destinations via Places Text Search).
- Application restriction: Android, package `com.sheguardai.app`, with **both** the debug
  keystore's and the release keystore's SHA-1 fingerprints registered on the key.
- API restrictions limited to Routes API + Places API (New) only.

**Supabase:**
- `SUPABASE_SECRET_KEY` must be the real **server-side service-role secret**, not a publishable
  key — set it in the backend/Render environment, never in source.
- Bucket (`sheguard-evidence`) must remain private.

**Fast2SMS:**
- A real, funded `FAST2SMS_API_KEY` and `COMMUNICATION_PROVIDER_MODE=real` are required in the
  production environment for real SMS dispatch. No real send has been performed from this
  repository's work so far.

**Release signing:**
- A real production keystore (via `app/signing.properties` or `SHEGUARD_RELEASE_*` env vars) is
  required before `assembleRelease` produces a production-signed artifact.

None of these values are stored in this repository, and none should ever be committed.

## 24. Known Limitations

- Android 12+/14+ background-execution restrictions can prevent a location foreground service from
  starting in some background/locked scenarios; the app handles this failure gracefully (no
  crash, no blocked emergency) but cannot guarantee continuous background location in every case.
- Route Safety's location sync to the backend is a simple fire-and-forget call, not backed by a
  persisted retry queue the way emergency location sync is — local tracking/deviation detection is
  unaffected, but a network gap can leave the backend's view of "last known location" briefly
  stale.
- Google Routes/Places functionality requires correct external Google Cloud configuration and
  quota (§23) — it cannot be verified as working end-to-end from source review alone.
- Ask SheGuard requires network/Gemini availability; there is no offline AI fallback.
- Physical-device validation (install, Metro-off launch, on-device SOS/Route Safety/Evidence smoke
  test) remains part of release validation and has not been completed in this repository context.
- Real production Fast2SMS delivery requires a funded provider account; only `PROVIDER_ACCEPTED`
  has ever been exercised in testing, never a real handset send.
- Production release signing requires the actual release keystore, not yet provided.

## 25. Intentionally Deferred Features

- **Threat Analysis** — not active, no implementation exists.
- **Alarm / Siren** — not active, no implementation exists.
- **Hardware button trigger** — `HardwareButtonActivationAdapter.ts` is an explicit placeholder
  (its own source comment says so); no OS-level hardware key intercept is wired.

These are not described elsewhere in this document as active features.

## 26. Security Notes

Never commit: `.env`, `local.properties`, `signing.properties`, keystores (`.keystore`/`.jks`),
API keys, JWT secrets, or generated build artifacts — all are covered by `.gitignore`. No example
in this README uses a real credential; where a placeholder is shown it is obviously a placeholder
(e.g. `<your key>`). Report any suspected committed secret immediately rather than working around
it.

## 27. Development Notes

- Project maturity: the defined feature scope (emergency core, Route Safety, Ask SheGuard,
  evidence/communication pipeline, official branding) is implemented and automated-tested per
  §20's baseline.
- Final validation remaining: Android unit-test run, debug/release build, release-signature
  verification, and physical-device smoke testing (SOS, Route Safety, Evidence, Ask SheGuard) are
  manual release-validation steps, not yet completed in this repository context.
- Deferred by design, not by omission: Threat Analysis and Alarm/Siren (§25).

## 28. License / Project Information

No `LICENSE` file exists in this repository. **License decision required** before any public
release — choose one (e.g. MIT, Apache-2.0, or proprietary/all-rights-reserved); none is assumed
or invented here.
