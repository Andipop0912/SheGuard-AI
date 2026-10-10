# SheGuard AI — API Contract (Phase 1, Phase 2A & Phase 2B)

This document specifies the exact REST API contract between the SheGuard AI React Native mobile app and the FastAPI backend.

---

## Base URL
`/api/v1`

---

## 1. Health Endpoints

### `GET /api/v1/health/live`
* **Auth**: None
* **Response 200 OK**:
  ```json
  {
    "status": "ok"
  }
  ```

### `GET /api/v1/health/ready`
* **Auth**: None
* **Response 200 OK**:
  ```json
  {
    "status": "ok",
    "database": "connected"
  }
  ```
* **Response 503 Service Unavailable**:
  ```json
  {
    "detail": "Database connection failed"
  }
  ```

---

## 2. Authentication & Device Binding Endpoints

### `POST /api/v1/auth/register`
Registers user, hashes password, binds hardware device, and issues JWT tokens.

* **Auth**: None
* **Request Body**:
  ```json
  {
    "phone": "+1234567890",
    "password": "SecurePassword123!",
    "deviceId": "dev-android-01",
    "platform": "android",
    "osVersion": "14",
    "appVersion": "1.0.0"
  }
  ```
* **Response 201 Created**:
  ```json
  {
    "accessToken": "eyJhbGciOiJIUzI1NiIsIn...",
    "refreshToken": "dGhpcy1pcy1hLXJlZnJlc2g...",
    "tokenType": "bearer",
    "userId": "d9b2d63d-a23c-4e8a-8a57-123456789abc",
    "deviceId": "dev-android-01"
  }
  ```

### `POST /api/v1/auth/login`
Authenticates user, validates/binds hardware device, and issues new token session.

* **Auth**: None
* **Request Body**:
  ```json
  {
    "phone": "+1234567890",
    "password": "SecurePassword123!",
    "deviceId": "dev-android-01"
  }
  ```
* **Response 200 OK**: Same as Register token response.

### `POST /api/v1/auth/refresh`
Refreshes access token using valid device-bound refresh token.

* **Auth**: None
* **Request Body**:
  ```json
  {
    "refreshToken": "dGhpcy1pcy1hLXJlZnJlc2g...",
    "deviceId": "dev-android-01"
  }
  ```
* **Response 200 OK**: New `accessToken` and new `refreshToken`.

### `POST /api/v1/auth/logout`
Revokes active refresh session.

* **Auth**: None
* **Request Body**:
  ```json
  {
    "refreshToken": "dGhpcy1pcy1hLXJlZnJlc2g..."
  }
  ```
* **Response 200 OK**: `{"success": true, "message": "Logged out successfully"}`

---

## 3. Emergency Event Synchronization Endpoint

### `POST /api/v1/emergencies/sync`
Synchronizes a batch of locally persisted emergency events. Handled **idempotently** via `eventId`.

* **Auth**: `Authorization: Bearer <accessToken>` (Device-bound context)
* **Request Body**:
  ```json
  {
    "events": [
      {
        "eventId": "evt-d9b2d63d-a23c-4e8a",
        "userId": "d9b2d63d-a23c-4e8a-8a57-123456789abc",
        "deviceId": "dev-android-01",
        "triggerSource": "VOICE",
        "state": "RESPONDING",
        "createdAt": 1700000000000,
        "updatedAt": 1700000000000,
        "resolvedAt": null,
        "metadata": {
          "keywordDetected": "sheguard emergency",
          "confidence": 0.95
        }
      }
    ]
  }
  ```

* **Supported Enums**:
  * `triggerSource`: `"MANUAL_SOS"`, `"VOICE"`, `"GESTURE"`, `"HARDWARE_BUTTON"`, `"SYSTEM"`
  * `state`: `"IDLE"`, `"TRIGGERED"`, `"RESPONDING"`, `"NOTIFYING"`, `"MONITORING"`, `"RESOLVED"`, `"CANCELLED"`

* **Response 200 OK**:
  ```json
  {
    "results": [
      {
        "eventId": "evt-d9b2d63d-a23c-4e8a",
        "status": "SYNCED",
        "serverReceivedAt": "2026-10-04T04:15:00.000Z",
        "message": null
      }
    ]
  }
  ```

* **Status Values**:
  * `SYNCED`: First time event persisted to backend database.
  * `UPDATED`: Newer client lifecycle update applied to existing event.
  * `ALREADY_SYNCED`: Event already stored on server (idempotent match or stale update ignored).
  * `FAILED`: Item level error (e.g. user ID or device ID mismatch with authenticated session).

---

## 4. Trusted Contacts API (Phase 2A)

All Trusted Contact endpoints enforce **strict multi-tenant ownership**: User A cannot read, modify, or delete User B's contacts.

### Accepted Phone Number Format
Phone numbers must be E.164 compliant (e.g. `+919876543210`) or 7 to 15 digits. Phone numbers are masked in backend logs to prevent sensitive exposure.

### `POST /api/v1/contacts`
Create a new trusted contact for the authenticated user.

* **Auth**: `Authorization: Bearer <accessToken>`
* **Request Body**:
  ```json
  {
    "name": "Jane Doe",
    "phone": "+919876543210",
    "relationship": "Sister",
    "priority": 1,
    "is_active": true
  }
  ```
* **Response 201 Created**:
  ```json
  {
    "id": "c1f7a8e2-3b4c-4d5e-8f9a-0b1c2d3e4f5a",
    "user_id": "d9b2d63d-a23c-4e8a-8a57-123456789abc",
    "name": "Jane Doe",
    "phone": "+919876543210",
    "relationship": "Sister",
    "priority": 1,
    "is_active": true,
    "created_at": "2026-10-04T04:30:00.000Z",
    "updated_at": "2026-10-04T04:30:00.000Z"
  }
  ```

### `GET /api/v1/contacts`
List all trusted contacts belonging to the authenticated user (ordered by priority ASC).

* **Auth**: `Authorization: Bearer <accessToken>`
* **Query Params**: `include_inactive: bool` (default `false`)
* **Response 200 OK**: Array of `TrustedContactDTO` objects.

### `GET /api/v1/contacts/{contact_id}`
Retrieve a specific trusted contact by ID.

* **Auth**: `Authorization: Bearer <accessToken>`
* **Response 200 OK**: `TrustedContactDTO`
* **Response 404 Not Found**: If contact does not exist or does not belong to user.

### `PATCH /api/v1/contacts/{contact_id}`
Update a trusted contact's details.

* **Auth**: `Authorization: Bearer <accessToken>`
* **Request Body**: (Partial fields allowed)
  ```json
  {
    "name": "Jane Smith",
    "priority": 2
  }
  ```
* **Response 200 OK**: Updated `TrustedContactDTO`

### `DELETE /api/v1/contacts/{contact_id}`
Delete a trusted contact permanently.

* **Auth**: `Authorization: Bearer <accessToken>`
* **Response 204 No Content**

---

## 5. Emergency Communication Logs (Phase 2A)

### Supported Enums
* `channel`: `"SMS"`, `"FCM"`, `"VOICE_CALL"`
* `status`: `"QUEUED"`, `"DISPATCHED"`, `"PROVIDER_ACCEPTED"`, `"DELIVERED"`, `"FAILED"`

### `POST /api/v1/emergency/communication/logs`
Record a new communication attempt for an emergency event.

* **Auth**: `Authorization: Bearer <accessToken>`

### `GET /api/v1/emergency/communication/logs/{event_id}`
Retrieve all communication attempt logs for a specific emergency event owned by the user.

---

## 6. Emergency Communication Dispatch API (Phase 2B & Phase 2C-A)

### `POST /api/v1/emergencies/{event_id}/dispatch`
Orchestrates emergency communication dispatch to active trusted contacts sorted by priority ASC (1 = Highest Priority).

* **Auth**: `Authorization: Bearer <accessToken>` (User ownership enforced)
* **Request Body**: (Optional)
  ```json
  {
    "channels": ["SMS"],
    "location_info": "GPS: 12.9716, 77.5946"
  }
  ```
* **Response 200 OK**:
  ```json
  {
    "event_id": "evt-d9b2d63d-a23c-4e8a",
    "total_contacts": 2,
    "total_attempts": 2,
    "successful_attempts": 2,
    "failed_attempts": 0,
    "attempts": [
      {
        "id": "7b8c9d0e-1f2a-3b4c-5d6e-7f8a9b0c1d2e",
        "contact_id": "c1f7a8e2-3b4c-4d5e-8f9a-0b1c2d3e4f5a",
        "contact_name": "Mother",
        "contact_phone": "+919876543210",
        "channel": "SMS",
        "status": "PROVIDER_ACCEPTED",
        "provider_message_id": "req_fast2sms_8f9a0b1c2d3e",
        "failure_reason": null,
        "attempted_at": "2026-10-04T04:37:00.000Z"
      }
    ]
  }
  ```

### **Core Invariants & Rules**
1. **Truthful Delivery Semantics**: `PROVIDER_ACCEPTED` is NEVER reported as `DELIVERED` unless an authenticated provider delivery callback explicitly confirms recipient delivery.
2. **Provider Resolution**: Resolved transparently by `ProviderRegistry` based on `COMMUNICATION_PROVIDER_MODE` (`"mock"` vs `"real"`) and `SMS_PROVIDER` (`"fast2sms"`). Mobile clients do not specify or know about underlying gateway provider credentials.
3. **Idempotency**: Repeated calls to `/emergencies/{event_id}/dispatch` reuse existing `(event_id, contact_id, channel)` logs without generating duplicate database rows.
4. **Failure Isolation**: A provider failure for Contact 1 does NOT interrupt dispatch for Contact 2 or Contact 3.
5. **Safety Protection**: Communication outcome NEVER mutates `EmergencyEvent.state` (remains `TRIGGERED` / `RESPONDING` independently).
6. **Error Sanitization**: Provider authorization errors or credential issues return generic sanitized failure reasons to client callers while logging context-rich non-sensitive metadata internally.

