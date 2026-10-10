from app.db.models.user import User

def test_user_registration_success(client, db_session):
    payload = {
        "phone": "+19876543210",
        "password": "SecurePassword123!",
        "deviceId": "dev-android-01",
        "platform": "android"
    }
    res = client.post("/api/v1/auth/register", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert "accessToken" in data
    assert "refreshToken" in data
    assert data["deviceId"] == "dev-android-01"

    # Verify password is hashed in database
    user = db_session.query(User).filter(User.phone == "+19876543210").first()
    assert user is not None
    assert user.password_hash != "SecurePassword123!"

def test_duplicate_phone_registration_rejected(client):
    payload = {
        "phone": "+19876543210",
        "password": "SecurePassword123!",
        "deviceId": "dev-android-01"
    }
    res1 = client.post("/api/v1/auth/register", json=payload)
    assert res1.status_code == 201

    res2 = client.post("/api/v1/auth/register", json=payload)
    assert res2.status_code == 400
    assert "already exists" in res2.json()["detail"]

def test_user_login_success(client):
    # Register first
    reg_payload = {
        "phone": "+19876543211",
        "password": "MySecretPassword!",
        "deviceId": "dev-android-02"
    }
    client.post("/api/v1/auth/register", json=reg_payload)

    # Login
    login_payload = {
        "phone": "+19876543211",
        "password": "MySecretPassword!",
        "deviceId": "dev-android-02"
    }
    res = client.post("/api/v1/auth/login", json=login_payload)
    assert res.status_code == 200
    data = res.json()
    assert "accessToken" in data
    assert "refreshToken" in data

def test_incorrect_password_rejected(client):
    reg_payload = {
        "phone": "+19876543212",
        "password": "CorrectPassword!",
        "deviceId": "dev-android-03"
    }
    client.post("/api/v1/auth/register", json=reg_payload)

    login_payload = {
        "phone": "+19876543212",
        "password": "WrongPassword!",
        "deviceId": "dev-android-03"
    }
    res = client.post("/api/v1/auth/login", json=login_payload)
    assert res.status_code == 401
    assert "Invalid phone number or password" in res.json()["detail"]

def test_inactive_user_rejected(client, db_session):
    reg_payload = {
        "phone": "+19876543213",
        "password": "Password123!",
        "deviceId": "dev-android-04"
    }
    client.post("/api/v1/auth/register", json=reg_payload)

    # Deactivate user in DB
    user = db_session.query(User).filter(User.phone == "+19876543213").first()
    user.is_active = False
    db_session.commit()

    login_payload = {
        "phone": "+19876543213",
        "password": "Password123!",
        "deviceId": "dev-android-04"
    }
    res = client.post("/api/v1/auth/login", json=login_payload)
    assert res.status_code == 403
    assert "inactive" in res.json()["detail"]

def test_refresh_token_lifecycle_and_revocation(client):
    reg_payload = {
        "phone": "+19876543214",
        "password": "Password123!",
        "deviceId": "dev-android-05"
    }
    reg_res = client.post("/api/v1/auth/register", json=reg_payload)
    refresh_token = reg_res.json()["refreshToken"]

    # Refresh access token
    refresh_payload = {
        "refreshToken": refresh_token,
        "deviceId": "dev-android-05"
    }
    ref_res = client.post("/api/v1/auth/refresh", json=refresh_payload)
    assert ref_res.status_code == 200
    new_data = ref_res.json()
    assert "accessToken" in new_data
    assert new_data["refreshToken"] != refresh_token

    # Logout (Revoke old token)
    logout_res = client.post("/api/v1/auth/logout", json={"refreshToken": refresh_token})
    assert logout_res.status_code == 200

    # Attempt reusing revoked old token
    ref_res_again = client.post("/api/v1/auth/refresh", json=refresh_payload)
    assert ref_res_again.status_code == 401
    assert "Invalid or revoked refresh token" in ref_res_again.json()["detail"]


def test_refresh_rejected_for_deactivated_device(client, db_session):
    from app.db.models.device import Device

    reg_res = client.post("/api/v1/auth/register", json={
        "phone": "+19876543299",
        "password": "Password123!",
        "deviceId": "dev-android-deactivated",
    })
    assert reg_res.status_code == 201
    refresh_payload = {"refreshToken": reg_res.json()["refreshToken"], "deviceId": "dev-android-deactivated"}

    device = db_session.query(Device).filter(Device.device_id == "dev-android-deactivated").first()
    device.is_active = False
    db_session.commit()

    ref_res = client.post("/api/v1/auth/refresh", json=refresh_payload)
    assert ref_res.status_code == 401
    assert "Device is not authorized" in ref_res.json()["detail"]

    # Signing in again re-activates the device binding and refresh works again.
    login_res = client.post("/api/v1/auth/login", json={
        "phone": "+19876543299",
        "password": "Password123!",
        "deviceId": "dev-android-deactivated",
    })
    assert login_res.status_code == 200
    ref_ok = client.post("/api/v1/auth/refresh", json={
        "refreshToken": login_res.json()["refreshToken"],
        "deviceId": "dev-android-deactivated",
    })
    assert ref_ok.status_code == 200
