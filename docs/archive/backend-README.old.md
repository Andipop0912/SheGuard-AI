# SheGuard AI — Backend (Phase 1, Phase 2A, Phase 2B, Phase 2C-A)

Foundational backend API for **SheGuard AI**, built with **Python 3.12**, **FastAPI**, **SQLAlchemy 2.0**, **Alembic**, and **PostgreSQL 16**.

## 1. Purpose & Non-Negotiable Safety Invariant

SheGuard AI follows a local-first safety architecture:
> **LOCAL SOS FIRST $\rightarrow$ BACKEND SECOND $\rightarrow$ AI THIRD**

The backend is **NEVER** a prerequisite for creating or triggering an emergency SOS. The mobile application creates, persists, and executes safety operations locally. Synchronization with this backend occurs asynchronously whenever network connectivity is established.

## 2. Directory Structure

```text
backend/
├── app/
│   ├── main.py                    # FastAPI entry point
│   ├── core/                      # Config, Security (bcrypt/JWT), Dependencies
│   ├── db/                        # SQLAlchemy engine, base, models (User, Device, RefreshSession, EmergencyEvent, TrustedContact, EmergencyCommunicationLog)
│   ├── schemas/                   # Pydantic v2 schemas (Auth, Device, Emergency, Contact, Communication)
│   ├── api/v1/                    # Health, Auth, Emergencies, Contacts, and Communication Routers
│   └── services/                  # AuthService, EmergencyService, ContactService, CommunicationService, MessageBuilder, ProviderRegistry, Fast2SmsCommunicationProvider
├── alembic/                       # Database migrations (001 Initial, 002 Contacts/Logs, 003 Idempotency Constraint)
├── tests/                         # Pytest test suite (50 automated tests)
├── docs/                          # API Contract documentation
├── Dockerfile                     # Container definition
├── docker-compose.yml             # Local PostgreSQL + FastAPI dev setup
├── requirements.txt               # Dependencies
└── README.md
```

## 3. Local Setup & Execution

### Prerequisites
- Python 3.12+
- PostgreSQL 16+ or Docker

### Running via Docker Compose (Recommended)
```bash
docker compose up --build
```
The API will be available at `http://localhost:8000`.  
OpenAPI documentation is served at `http://localhost:8000/api/v1/docs`.

### Running Locally (Virtualenv)
```bash
# 1. Create & activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Setup environment variables
cp .env.example .env

# 4. Run database migrations
alembic upgrade head

# 5. Start Uvicorn development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 4. Running Pytest Test Suite

```bash
pytest
```
*Current test suite: 50 passed, 0 failed.*

---

## 5. Environment & Communication Provider Configuration (Phase 2C-A)

Communication provider resolution is controlled dynamically via environment variables in `app/core/config.py`:

```env
# Communication Provider Mode ('mock' or 'real')
COMMUNICATION_PROVIDER_MODE=mock

# SMS Provider Selection ('fast2sms' or future gateways)
SMS_PROVIDER=fast2sms

# Fast2SMS Credentials & Base Endpoint
FAST2SMS_API_KEY=
FAST2SMS_BASE_URL=https://www.fast2sms.com/dev/bulkV2

# Global HTTP Request Timeout (Seconds)
HTTP_REQUEST_TIMEOUT_SECONDS=5.0
```

### Safety & Determinism Rules
- **Mock Mode Default**: When `COMMUNICATION_PROVIDER_MODE=mock`, `ProviderRegistry` resolves `MockSmsProvider`. No external network requests occur, keeping CI and local unit tests deterministic.
- **Real Mode Resolution**: When `COMMUNICATION_PROVIDER_MODE=real` and `SMS_PROVIDER=fast2sms`, `ProviderRegistry` resolves `Fast2SmsCommunicationProvider`.
- **Credential Protection**: API keys and authorization headers are sanitized and never logged or exposed in client error payloads.

---

## 6. Manual Real Provider Integration Testing Procedure

To manually test real SMS delivery with Fast2SMS without affecting automated CI runs:

1. Obtain valid Fast2SMS API credentials from `https://www.fast2sms.com/`.
2. Configure `.env` locally:
   ```env
   COMMUNICATION_PROVIDER_MODE=real
   SMS_PROVIDER=fast2sms
   FAST2SMS_API_KEY=your_actual_fast2sms_api_key
   ```
3. Register a test user and add your explicit test phone number as a trusted contact via `/api/v1/contacts`.
4. Trigger emergency dispatch via `POST /api/v1/emergencies/{event_id}/dispatch`.
5. Check backend logs for `Fast2SMS dispatch requested` and confirm SMS reception on the target test device.
6. Revert `COMMUNICATION_PROVIDER_MODE=mock` after testing.

---

## 7. Backend Capabilities & Phase Progress

### **Phase 1: Auth & Emergency Core**
- **User Identity & Device Binding**: Phone registration with bcrypt password hashing, JWT Bearer access tokens (15 min), and device-bound refresh tokens (30 days).
- **Idempotent Emergency Synchronization**: `POST /api/v1/emergencies/sync` endpoint accepting batch client-persisted emergency events. Guarantees deduplication via client-generated `eventId`.
- **Health & Readiness Checks**: `/health/live` and `/health/ready` endpoints.

### **Phase 2A: Trusted Contacts & Communication Foundation**
- **Trusted Contacts CRUD**: `POST/GET/PATCH/DELETE /api/v1/contacts` with strict multi-tenant ownership enforcement (`user_id == current_user.id`) and E.164 phone validation.
- **Emergency Communication Logs**: `POST/GET /api/v1/emergency/communication/logs` model and REST endpoints.

### **Phase 2B: Communication Dispatch Engine**
- **Emergency Dispatch Orchestrator**: `POST /api/v1/emergencies/{event_id}/dispatch` endpoint.
- **Contact Priority Ordering**: Contacts ordered by priority integer ASC (1 = Highest).
- **Truthful Delivery Semantics**: `PROVIDER_ACCEPTED` is explicitly distinguished from `DELIVERED`. Messages are never falsely marked `DELIVERED` without explicit provider delivery receipt confirmation.
- **Idempotent Dispatch**: Uses `(event_id, contact_id, channel)` database unique constraint (`uq_event_contact_channel`) to prevent duplicate dispatch logs.
- **Failure Isolation**: A dispatch failure for one contact/channel does NOT stop processing for remaining contacts.
- **Bounded Application-Level Retry**: Configurable bounded retry loop (up to `MAX_DISPATCH_RETRIES = 2`) for transient failures.

### **Phase 2C-A: Real SMS Provider Integration (Fast2SMS)**
- **Fast2SMS Provider Adapter**: `Fast2SmsCommunicationProvider` implementing `CommunicationProvider` abstraction.
- **HTTP Client Security & Timeout**: Uses `httpx.AsyncClient` with a finite 5.0-second timeout.
- **Phone Number Sanitization**: Automatically normalizes phone numbers to 10-digit format expected by Indian SMS gateways.
- **Error Classification**:
  - *Retryable*: Connection timeouts, network errors, HTTP 5xx gateway errors.
  - *Non-Retryable*: Missing API key, HTTP 401/403 authorization failures, malformed provider JSON payloads, provider level rejection (`return: false`).
- **Idempotency Note**: DB-level uniqueness prevents duplicate log entries. If a network drop occurs after the SMS gateway accepts a request but before SheGuard receives the response, a retry may resend the SMS. Exactly-once external delivery is not guaranteed by HTTP gateways without provider-side idempotency keys.

