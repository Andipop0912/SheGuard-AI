import pytest
from fastapi import status

def register_and_login(client, phone, password="Password123!"):
    # Register user
    reg_resp = client.post(
        "/api/v1/auth/register",
        json={"phone": phone, "password": password, "deviceId": f"device_{phone[-4:]}"}
    )
    assert reg_resp.status_code == status.HTTP_201_CREATED, reg_resp.json()
    data = reg_resp.json()
    token = data["accessToken"]
    user_id = data["userId"]
    return {"Authorization": f"Bearer {token}"}, user_id

def test_create_trusted_contact_success(client):
    headers, _ = register_and_login(client, "+919876543210")
    payload = {
        "name": "Jane Doe",
        "phone": "+919876543211",
        "relationship": "Sister",
        "priority": 1,
        "is_active": True,
    }
    resp = client.post("/api/v1/contacts", json=payload, headers=headers)
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()
    assert data["name"] == "Jane Doe"
    assert data["phone"] == "+919876543211"
    assert data["relationship"] == "Sister"
    assert data["priority"] == 1
    assert data["is_active"] is True
    assert "id" in data
    assert "user_id" in data

def test_list_trusted_contacts(client):
    headers, _ = register_and_login(client, "+919876543212")
    client.post("/api/v1/contacts", json={"name": "Contact 1", "phone": "+919876543213", "priority": 2}, headers=headers)
    client.post("/api/v1/contacts", json={"name": "Contact 2", "phone": "+919876543214", "priority": 1}, headers=headers)

    resp = client.get("/api/v1/contacts", headers=headers)
    assert resp.status_code == status.HTTP_200_OK
    contacts = resp.json()
    assert len(contacts) == 2
    # Check ordered by priority ASC
    assert contacts[0]["name"] == "Contact 2"
    assert contacts[1]["name"] == "Contact 1"

def test_get_trusted_contact_by_id(client):
    headers, _ = register_and_login(client, "+919876543215")
    create_resp = client.post("/api/v1/contacts", json={"name": "Contact A", "phone": "+919876543216"}, headers=headers)
    contact_id = create_resp.json()["id"]

    get_resp = client.get(f"/api/v1/contacts/{contact_id}", headers=headers)
    assert get_resp.status_code == status.HTTP_200_OK
    assert get_resp.json()["id"] == contact_id

def test_update_trusted_contact(client):
    headers, _ = register_and_login(client, "+919876543217")
    create_resp = client.post("/api/v1/contacts", json={"name": "Contact B", "phone": "+919876543218"}, headers=headers)
    contact_id = create_resp.json()["id"]

    patch_resp = client.patch(
        f"/api/v1/contacts/{contact_id}",
        json={"name": "Updated Name", "priority": 5},
        headers=headers
    )
    assert patch_resp.status_code == status.HTTP_200_OK
    assert patch_resp.json()["name"] == "Updated Name"
    assert patch_resp.json()["priority"] == 5

def test_delete_trusted_contact(client):
    headers, _ = register_and_login(client, "+919876543219")
    create_resp = client.post("/api/v1/contacts", json={"name": "Contact C", "phone": "+919876543220"}, headers=headers)
    contact_id = create_resp.json()["id"]

    del_resp = client.delete(f"/api/v1/contacts/{contact_id}", headers=headers)
    assert del_resp.status_code == status.HTTP_204_NO_CONTENT

    get_resp = client.get(f"/api/v1/contacts/{contact_id}", headers=headers)
    assert get_resp.status_code == status.HTTP_404_NOT_FOUND

def test_unauthenticated_access_rejected(client):
    resp = client.get("/api/v1/contacts")
    assert resp.status_code in [status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN]

def test_user_a_cannot_access_or_modify_user_b_contact(client):
    headers_a, _ = register_and_login(client, "+919876543221")
    headers_b, _ = register_and_login(client, "+919876543222")

    create_resp = client.post("/api/v1/contacts", json={"name": "User A Contact", "phone": "+919876543223"}, headers=headers_a)
    contact_id = create_resp.json()["id"]

    # User B attempts get
    get_resp = client.get(f"/api/v1/contacts/{contact_id}", headers=headers_b)
    assert get_resp.status_code == status.HTTP_404_NOT_FOUND

    # User B attempts patch
    patch_resp = client.patch(f"/api/v1/contacts/{contact_id}", json={"name": "Hacked"}, headers=headers_b)
    assert patch_resp.status_code == status.HTTP_404_NOT_FOUND

    # User B attempts delete
    del_resp = client.delete(f"/api/v1/contacts/{contact_id}", headers=headers_b)
    assert del_resp.status_code == status.HTTP_404_NOT_FOUND

def test_invalid_phone_rejected(client):
    headers, _ = register_and_login(client, "+919876543224")
    
    # Invalid letters
    resp1 = client.post("/api/v1/contacts", json={"name": "Test", "phone": "invalid_phone"}, headers=headers)
    assert resp1.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    # Too short
    resp2 = client.post("/api/v1/contacts", json={"name": "Test", "phone": "123"}, headers=headers)
    assert resp2.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

def test_invalid_priority_rejected(client):
    headers, _ = register_and_login(client, "+919876543225")
    
    resp = client.post("/api/v1/contacts", json={"name": "Test", "phone": "+919876543226", "priority": 0}, headers=headers)
    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
