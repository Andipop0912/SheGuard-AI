from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

db_url = settings.DATABASE_URL
try:
    if db_url.startswith("postgresql"):
        import psycopg2
    engine = create_engine(db_url, pool_pre_ping=True, echo=False)
except (ImportError, Exception):
    # Fallback to SQLite for environments without PostgreSQL drivers installed
    db_url = "sqlite:///./sheguard_dev.db"
    engine = create_engine(db_url, connect_args={"check_same_thread": False}, pool_pre_ping=True, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
