"""Initial Phase 1 Schema: Users, Devices, RefreshSessions, EmergencyEvents

Revision ID: 001_initial_phase1_schema
Revises: 
Create Date: 2026-10-04 04:15:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_initial_phase1_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Create Users Table
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('phone', sa.String(length=20), nullable=False),
        sa.Column('password_hash', sa.String(length=255), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(op.f('ix_users_phone'), 'users', ['phone'], unique=True)

    # 2. Create Devices Table
    op.create_table(
        'devices',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('device_id', sa.String(length=64), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('platform', sa.String(length=20), nullable=False, server_default='android'),
        sa.Column('os_version', sa.String(length=50), nullable=True),
        sa.Column('app_version', sa.String(length=50), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('user_id', 'device_id', name='uq_user_device')
    )
    op.create_index(op.f('ix_devices_device_id'), 'devices', ['device_id'], unique=False)
    op.create_index(op.f('ix_devices_user_id'), 'devices', ['user_id'], unique=False)

    # 3. Create Refresh Sessions Table
    op.create_table(
        'refresh_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=False),
        sa.Column('token_hash', sa.String(length=255), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('revoked_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(op.f('ix_refresh_sessions_user_id'), 'refresh_sessions', ['user_id'], unique=False)
    op.create_index(op.f('ix_refresh_sessions_token_hash'), 'refresh_sessions', ['token_hash'], unique=False)

    # 4. Create Emergency Events Table
    trigger_enum = postgresql.ENUM('MANUAL_SOS', 'VOICE', 'GESTURE', 'HARDWARE_BUTTON', 'SYSTEM', name='emergency_trigger_source_enum')
    trigger_enum.create(op.get_bind(), checkfirst=True)

    state_enum = postgresql.ENUM('IDLE', 'TRIGGERED', 'RESPONDING', 'NOTIFYING', 'MONITORING', 'RESOLVED', 'CANCELLED', name='emergency_state_enum')
    state_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'emergency_events',
        sa.Column('event_id', sa.String(length=64), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=False),
        sa.Column('trigger_source', postgresql.ENUM('MANUAL_SOS', 'VOICE', 'GESTURE', 'HARDWARE_BUTTON', 'SYSTEM', name='emergency_trigger_source_enum', create_type=False), nullable=False),
        sa.Column('state', postgresql.ENUM('IDLE', 'TRIGGERED', 'RESPONDING', 'NOTIFYING', 'MONITORING', 'RESOLVED', 'CANCELLED', name='emergency_state_enum', create_type=False), nullable=False, server_default='TRIGGERED'),
        sa.Column('client_created_at', sa.BigInteger(), nullable=False),
        sa.Column('client_updated_at', sa.BigInteger(), nullable=False),
        sa.Column('resolved_at', sa.BigInteger(), nullable=True),
        sa.Column('server_received_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('metadata_json', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(op.f('ix_emergency_events_user_id'), 'emergency_events', ['user_id'], unique=False)

def downgrade() -> None:
    op.drop_index(op.f('ix_emergency_events_user_id'), table_name='emergency_events')
    op.drop_table('emergency_events')

    trigger_enum = postgresql.ENUM(name='emergency_trigger_source_enum')
    trigger_enum.drop(op.get_bind(), checkfirst=True)

    state_enum = postgresql.ENUM(name='emergency_state_enum')
    state_enum.drop(op.get_bind(), checkfirst=True)

    op.drop_index(op.f('ix_refresh_sessions_token_hash'), table_name='refresh_sessions')
    op.drop_index(op.f('ix_refresh_sessions_user_id'), table_name='refresh_sessions')
    op.drop_table('refresh_sessions')

    op.drop_index(op.f('ix_devices_user_id'), table_name='devices')
    op.drop_index(op.f('ix_devices_device_id'), table_name='devices')
    op.drop_table('devices')

    op.drop_index(op.f('ix_users_phone'), table_name='users')
    op.drop_table('users')
