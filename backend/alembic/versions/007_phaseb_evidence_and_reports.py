"""Phase B: cloud evidence metadata and incident report metadata (binaries in Supabase)

Revision ID: 007_phaseb_evidence_and_reports
Revises: 006_phaseb_route_safety
Create Date: 2026-10-10 05:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '007_phaseb_evidence_and_reports'
down_revision: Union[str, None] = '006_phaseb_route_safety'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    status_enum = postgresql.ENUM('PENDING', 'UPLOADED', 'FAILED', name='evidence_upload_status_enum')
    status_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'evidence_items',
        sa.Column('evidence_id', sa.String(length=64), primary_key=True),
        sa.Column('event_id', sa.String(length=64), sa.ForeignKey('emergency_events.event_id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('type', sa.String(length=16), nullable=False, server_default='AUDIO'),
        sa.Column('file_name', sa.String(length=255), nullable=False),
        sa.Column('mime_type', sa.String(length=64), nullable=False),
        sa.Column('storage_bucket', sa.String(length=128), nullable=True),
        sa.Column('storage_path', sa.String(length=512), nullable=True),
        sa.Column('size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('duration_ms', sa.BigInteger(), nullable=True),
        sa.Column('checksum', sa.String(length=128), nullable=True),
        sa.Column('upload_status', postgresql.ENUM('PENDING', 'UPLOADED', 'FAILED', name='evidence_upload_status_enum', create_type=False), nullable=False, server_default='PENDING'),
        sa.Column('upload_error', sa.String(length=500), nullable=True),
        sa.Column('client_created_at', sa.BigInteger(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(op.f('ix_evidence_items_event_id'), 'evidence_items', ['event_id'], unique=False)
    op.create_index(op.f('ix_evidence_items_user_id'), 'evidence_items', ['user_id'], unique=False)

    op.create_table(
        'incident_reports',
        sa.Column('report_id', sa.String(length=64), primary_key=True),
        sa.Column('event_id', sa.String(length=64), sa.ForeignKey('emergency_events.event_id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('storage_bucket', sa.String(length=128), nullable=True),
        sa.Column('storage_path', sa.String(length=512), nullable=True),
        sa.Column('size_bytes', sa.BigInteger(), nullable=True),
        sa.Column('upload_status', postgresql.ENUM('PENDING', 'UPLOADED', 'FAILED', name='evidence_upload_status_enum', create_type=False), nullable=False, server_default='PENDING'),
        sa.Column('upload_error', sa.String(length=500), nullable=True),
        sa.Column('generated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(op.f('ix_incident_reports_event_id'), 'incident_reports', ['event_id'], unique=False)
    op.create_index(op.f('ix_incident_reports_user_id'), 'incident_reports', ['user_id'], unique=False)

    # Idempotency gate for the five-minute evidence-delivery workflow: set exactly once per
    # emergency, atomically claimed, so the workflow can never run twice for the same incident.
    op.add_column('emergency_events', sa.Column('evidence_delivered_at', sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        'evidence_delivery_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('event_id', sa.String(length=64), sa.ForeignKey('emergency_events.event_id', ondelete='CASCADE'), nullable=False),
        sa.Column('contact_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('trusted_contacts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('channel', postgresql.ENUM('SMS', 'FCM', 'VOICE_CALL', name='communication_channel_enum', create_type=False), nullable=False),
        sa.Column('status', postgresql.ENUM('QUEUED', 'DISPATCHED', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED', 'NOT_SENT', 'UNCERTAIN', name='communication_status_enum', create_type=False), nullable=False),
        sa.Column('provider_message_id', sa.String(length=255), nullable=True),
        sa.Column('failure_reason', sa.String(length=500), nullable=True),
        sa.Column('is_simulated', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(op.f('ix_evidence_delivery_logs_event_id'), 'evidence_delivery_logs', ['event_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_evidence_delivery_logs_event_id'), table_name='evidence_delivery_logs')
    op.drop_table('evidence_delivery_logs')
    op.drop_column('emergency_events', 'evidence_delivered_at')

    op.drop_index(op.f('ix_incident_reports_user_id'), table_name='incident_reports')
    op.drop_index(op.f('ix_incident_reports_event_id'), table_name='incident_reports')
    op.drop_table('incident_reports')

    op.drop_index(op.f('ix_evidence_items_user_id'), table_name='evidence_items')
    op.drop_index(op.f('ix_evidence_items_event_id'), table_name='evidence_items')
    op.drop_table('evidence_items')

    status_enum = postgresql.ENUM(name='evidence_upload_status_enum')
    status_enum.drop(op.get_bind(), checkfirst=True)
