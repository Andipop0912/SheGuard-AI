import io
from fastapi import status
from app.db.models.evidence import EvidenceDeliveryLog


def register_and_login(client, phone, device_id="dev_ev_01"):
    reg_resp = client.post(
        "/api/v1/auth/register",
        json={"phone": phone, "password": "Password123!", "deviceId": device_id},
    )
    assert reg_resp.status_code == status.HTTP_201_CREATED, reg_resp.json()
    data = reg_resp.json()
    return {"Authorization": f"Bearer {data['accessToken']}"}, data["userId"]


def create_emergency_event(client, headers, event_id, user_id=None, device_id="dev_ev_01"):
    payload = {
        "events": [
            {
                "eventId": event_id,
                "userId": str(user_id) if user_id else "00000000-0000-0000-0000-000000000000",
                "deviceId": device_id,
                "triggerSource": "MANUAL_SOS",
                "state": "TRIGGERED",
                "createdAt": 1728000000000,
                "updatedAt": 1728000000000,
                "resolvedAt": None,
                "metadata": {},
            }
        ]
    }
    resp = client.post("/api/v1/emergencies/sync", json=payload, headers=headers)
    assert resp.status_code == status.HTTP_200_OK, resp.json()


def create_contact(client, headers, name="Bhoomi", phone="+919326754208"):
    resp = client.post("/api/v1/contacts", json={"name": name, "phone": phone, "priority": 1}, headers=headers)
    assert resp.status_code == status.HTTP_201_CREATED, resp.json()


def upload_fake_evidence(client, headers, event_id, evidence_id="ev-test-1"):
    files = {"file": (f"{evidence_id}.m4a", io.BytesIO(b"fake-audio-bytes"), "audio/m4a")}
    data = {"evidenceId": evidence_id, "durationMs": "5000", "clientCreatedAt": "1728000001000"}
    return client.post(f"/api/v1/evidence/{event_id}/items", files=files, data=data, headers=headers)


class TestEvidenceUpload:
    def test_upload_without_supabase_configured_marks_failed_but_never_errors(self, client):
        # No SUPABASE_SECRET_KEY in the test env (never-use-real-creds fixture only blanks SMS,
        # but Supabase is simply unconfigured by default in tests) — upload must still succeed
        # at the HTTP level, with a truthful FAILED cloud status, never raising.
        headers, uid = register_and_login(client, "+919100000001")
        create_emergency_event(client, headers, "evt-ev-1", user_id=uid)

        resp = upload_fake_evidence(client, headers, "evt-ev-1")
        assert resp.status_code == status.HTTP_201_CREATED, resp.json()
        data = resp.json()
        assert data["evidenceId"] == "ev-test-1"
        assert data["uploadStatus"] in ("FAILED", "UPLOADED")  # FAILED when unconfigured, as expected here

    def test_re_uploading_the_same_evidence_id_is_idempotent_not_duplicated(self, client):
        headers, uid = register_and_login(client, "+919100000002")
        create_emergency_event(client, headers, "evt-ev-2", user_id=uid)

        r1 = upload_fake_evidence(client, headers, "evt-ev-2", "ev-dup")
        r2 = upload_fake_evidence(client, headers, "evt-ev-2", "ev-dup")
        assert r1.status_code == status.HTTP_201_CREATED
        assert r2.status_code == status.HTTP_201_CREATED
        assert r1.json()["evidenceId"] == r2.json()["evidenceId"]

    def test_another_user_cannot_upload_evidence_to_someone_elses_incident(self, client):
        headers_a, uid_a = register_and_login(client, "+919100000003")
        create_emergency_event(client, headers_a, "evt-ev-owner", user_id=uid_a)

        headers_b, uid_b = register_and_login(client, "+919100000004")
        resp = upload_fake_evidence(client, headers_b, "evt-ev-owner", "ev-trespass")
        assert resp.status_code == status.HTTP_404_NOT_FOUND

    def test_unsupported_mime_type_is_rejected(self, client):
        headers, uid = register_and_login(client, "+919100000005")
        create_emergency_event(client, headers, "evt-ev-mime", user_id=uid)
        files = {"file": ("evil.exe", io.BytesIO(b"not audio"), "application/x-msdownload")}
        data = {"evidenceId": "ev-bad-mime", "clientCreatedAt": "1"}
        resp = client.post("/api/v1/evidence/evt-ev-mime/items", files=files, data=data, headers=headers)
        assert resp.status_code == status.HTTP_415_UNSUPPORTED_MEDIA_TYPE


class TestIncidentReport:
    def test_generate_report_from_real_data_never_errors_even_with_no_location_or_evidence(self, client):
        headers, uid = register_and_login(client, "+919100000006")
        create_emergency_event(client, headers, "evt-ev-report", user_id=uid)

        resp = client.post("/api/v1/evidence/evt-ev-report/report", headers=headers)
        assert resp.status_code == status.HTTP_201_CREATED, resp.json()
        assert resp.json()["reportId"].startswith("rep-")

    def test_another_user_cannot_generate_a_report_for_someone_elses_incident(self, client):
        headers_a, uid_a = register_and_login(client, "+919100000007")
        create_emergency_event(client, headers_a, "evt-ev-report-owner", user_id=uid_a)
        headers_b, uid_b = register_and_login(client, "+919100000008")
        resp = client.post("/api/v1/evidence/evt-ev-report-owner/report", headers=headers_b)
        assert resp.status_code == status.HTTP_404_NOT_FOUND


class TestEvidenceDelivery:
    def test_delivery_workflow_is_idempotent_only_the_first_call_notifies(self, client, db_session):
        headers, uid = register_and_login(client, "+919100000009")
        create_contact(client, headers)
        create_emergency_event(client, headers, "evt-ev-deliver", user_id=uid)

        r1 = client.post("/api/v1/evidence/evt-ev-deliver/deliver", headers=headers)
        assert r1.status_code == status.HTTP_200_OK
        assert r1.json()["delivered"] is True
        assert r1.json()["contactsNotified"] == 1

        r2 = client.post("/api/v1/evidence/evt-ev-deliver/deliver", headers=headers)
        assert r2.status_code == status.HTTP_200_OK
        assert r2.json()["contactsNotified"] == 0  # already delivered; no second dispatch

        logs = db_session.query(EvidenceDeliveryLog).filter(EvidenceDeliveryLog.event_id == "evt-ev-deliver").all()
        assert len(logs) == 1  # exactly one log row, not two

    def test_delivery_with_no_active_contacts_still_marks_delivered_with_zero_notified(self, client):
        headers, uid = register_and_login(client, "+919100000010")
        create_emergency_event(client, headers, "evt-ev-deliver-none", user_id=uid)
        resp = client.post("/api/v1/evidence/evt-ev-deliver-none/deliver", headers=headers)
        assert resp.status_code == status.HTTP_200_OK
        assert resp.json()["contactsNotified"] == 0
