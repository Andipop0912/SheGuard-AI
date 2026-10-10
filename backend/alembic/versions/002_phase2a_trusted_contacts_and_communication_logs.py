"""Phase 2A Schema: Trusted Contacts and Emergency Communication Logs

Revision ID: 002_phase2a_trusted_contacts_and_communication_logs
Revises: 001_initial_phase1_schema
Create Date: 2026-10-04 04:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '002_phase2a_trusted_contacts_and_communication_logs'
down_revision: Union[str, None] = '001_initial_phase1_schema'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    # 1. Create Trusted Contacts Table
    op.create_table(
        'trusted_contacts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('phone', sa.String(length=20), nullable=False),
        sa.Column('relationship', sa.String(length=50), nullable=True),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(op.f('ix_trusted_contacts_user_id'), 'trusted_contacts', ['user_id'], unique=False)
    op.create_index(op.f('ix_trusted_contacts_phone'), 'trusted_contacts', ['phone'], unique=False)

    # 2. Create Communication Enums
    channel_enum = postgresql.ENUM('SMS', 'FCM', 'VOICE_CALL', name='communication_channel_enum')
    channel_enum.create(op.get_bind(), checkfirst=True)

    status_enum = postgresql.ENUM('QUEUED', 'DISPATCHED', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED', name='communication_status_enum')
    status_enum.create(op.get_bind(), checkfirst=True)

    # 3. Create Emergency Communication Logs Table
    op.create_table(
        'emergency_communication_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('event_id', sa.String(length=64), sa.ForeignKey('emergency_events.event_id', ondelete='CASCADE'), nullable=False),
        sa.Column('contact_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('trusted_contacts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('channel', postgresql.ENUM('SMS', 'FCM', 'VOICE_CALL', name='communication_channel_enum', create_type=False), nullable=False),
        sa.Column('status', postgresql.ENUM('QUEUED', 'DISPATCHED', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED', name='communication_status_enum', create_type=False), nullable=False, server_default='QUEUED'),
        sa.Column('provider_message_id', sa.String(length=255), nullable=True),
        sa.Column('attempted_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('provider_accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failure_reason', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(op.f('ix_emergency_communication_logs_event_id'), 'emergency_communication_logs', ['event_id'], unique=False)
    op.create_index(op.f('ix_emergency_communication_logs_contact_id'), 'emergency_communication_logs', ['contact_id'], unique=False)

def downgrade() -> None:
    op.drop_index(op.f('ix_emergency_communication_logs_contact_id'), table_name='emergency_communication_logs')
    op.drop_index(op.f('ix_emergency_communication_logs_event_id'), table_name='emergency_communication_logs')
    op.drop_table('emergency_communication_logs')

    status_enum = postgresql.ENUM(name='communication_status_enum')
    status_enum.drop(op.get_bind(), checkfirst=True)

    channel_enum = postgresql.ENUM(name='communication_channel_enum')
    channel_enum.drop(op.get_bind(), checkfirst=True)

    op.drop_index(op.f('ix_trusted_contacts_phone'), table_name='trusted_contacts')
    op.drop_index(op.f('ix_trusted_contacts_user_id'), table_name='trusted_contacts')
    op.drop_table('trusted_contacts')
