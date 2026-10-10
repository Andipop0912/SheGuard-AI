import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.db.base import Base
from contextlib import contextmanager
from app.core.config import settings
from app.core.dependencies import get_db, get_dispatch_session_scope
from app.main import app

# In-memory SQLite with StaticPool for fast, isolated test database session
SQLALCHEMY_TEST_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)

@pytest.fixture(autouse=True)
def never_use_real_sms_credentials(monkeypatch):
    """
    Tests must never reach a real SMS provider. backend/.env may hold a real FAST2SMS_API_KEY for
    manual device testing; every test runs with no key and the simulated provider instead.
    """
    monkeypatch.setattr(settings, "FAST2SMS_API_KEY", "")
    monkeypatch.setattr(settings, "COMMUNICATION_PROVIDER_MODE", "mock")
    monkeypatch.setattr(settings, "SMS_PROVIDER", "mock")
    monkeypatch.setattr(settings, "SUPABASE_SECRET_KEY", "")
    monkeypatch.setattr(settings, "SUPABASE_URL", "")


    import httpx

    async def refuse_real_network(self, request, *args, **kwargs):
        raise RuntimeError(f"Real network access is disabled in tests: {request.method} {request.url.host}")

    # Only httpx's real network transport is blocked; in-memory MockTransport clients keep working.
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", refuse_real_network)


@pytest.fixture(autouse=True)
def no_dispatch_location_wait(monkeypatch):
    """Tests upload locations explicitly when they need them; do not wait for the phone."""
    monkeypatch.setattr(settings, "DISPATCH_LOCATION_GRACE_SECONDS", 0.0)


@pytest.fixture(scope="function")
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    @contextmanager
    def test_dispatch_scope():
        # Background dispatch shares the test session (not closed by the run).
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_dispatch_session_scope] = lambda: test_dispatch_scope
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
