"""Phase B: Route Safety sessions and their communication logs

Revision ID: 006_phaseb_route_safety
Revises: 005_phase3d_communication_truthfulness
Create Date: 2026-10-10 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '006_phaseb_route_safety'
down_revision: Union[str, None] = '005_phase3d_communication_truthfulness'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    status_enum = postgresql.ENUM('ACTIVE', 'ENDED', 'CANCELLED', name='route_safety_status_enum')
    status_enum.create(op.get_bind(), checkfirst=True)

    deviation_enum = postgresql.ENUM(
        'ON_ROUTE', 'POSSIBLE_DEVIATION', 'DEROUTED', 'RETURNED_TO_ROUTE', name='route_deviation_state_enum'
    )
    deviation_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        'route_safety_sessions',
        sa.Column('session_id', sa.String(length=64), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=False),
        sa.Column('status', sa.Enum('ACTIVE', 'ENDED', 'CANCELLED', name='route_safety_status_enum', create_type=False), nullable=False, server_default='ACTIVE'),
        sa.Column('start_latitude', sa.Float(), nullable=False),
        sa.Column('start_longitude', sa.Float(), nullable=False),
        sa.Column('destination_text', sa.String(length=500), nullable=False),
        sa.Column('destination_latitude', sa.Float(), nullable=True),
        sa.Column('destination_longitude', sa.Float(), nullable=True),
        sa.Column('route_polyline', sa.JSON(), nullable=True),
        sa.Column('route_distance_meters', sa.Float(), nullable=True),
        sa.Column('route_duration_seconds', sa.Integer(), nullable=True),
        sa.Column('current_latitude', sa.Float(), nullable=True),
        sa.Column('current_longitude', sa.Float(), nullable=True),
        sa.Column('last_location_at', sa.BigInteger(), nullable=True),
        sa.Column(
            'deviation_state',
            sa.Enum('ON_ROUTE', 'POSSIBLE_DEVIATION', 'DEROUTED', 'RETURNED_TO_ROUTE', name='route_deviation_state_enum', create_type=False),
            nullable=False,
            server_default='ON_ROUTE',
        ),
        sa.Column('deviation_state_since', sa.BigInteger(), nullable=True),
        sa.Column('deviation_alert_sent_at', sa.BigInteger(), nullable=True),
        sa.Column('share_token', sa.String(length=64), nullable=False),
        sa.Column('client_started_at', sa.BigInteger(), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
    )
    op.create_index(op.f('ix_route_safety_sessions_user_id'), 'route_safety_sessions', ['user_id'], unique=False)
    op.create_index(op.f('ix_route_safety_sessions_share_token'), 'route_safety_sessions', ['share_token'], unique=True)

    op.create_table(
        'route_safety_communication_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('session_id', sa.String(length=64), sa.ForeignKey('route_safety_sessions.session_id', ondelete='CASCADE'), nullable=False),
        sa.Column('contact_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('trusted_contacts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('channel', sa.Enum('SMS', 'FCM', 'VOICE_CALL', name='communication_channel_enum', create_type=False), nullable=False),
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column(
            'status',
            sa.Enum('QUEUED', 'DISPATCHED', 'PROVIDER_ACCEPTED', 'DELIVERED', 'FAILED', 'NOT_SENT', 'UNCERTAIN', name='communication_status_enum', create_type=False),
            nullable=False,
        ),
        sa.Column('provider_message_id', sa.String(length=255), nullable=True),
        sa.Column('failure_reason', sa.String(length=500), nullable=True),
        sa.Column('is_simulated', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('session_id', 'contact_id', 'channel', 'kind', name='uq_route_safety_session_contact_channel_kind'),
    )
    op.create_index(op.f('ix_route_safety_communication_logs_session_id'), 'route_safety_communication_logs', ['session_id'], unique=False)
    op.create_index(op.f('ix_route_safety_communication_logs_contact_id'), 'route_safety_communication_logs', ['contact_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_route_safety_communication_logs_contact_id'), table_name='route_safety_communication_logs')
    op.drop_index(op.f('ix_route_safety_communication_logs_session_id'), table_name='route_safety_communication_logs')
    op.drop_table('route_safety_communication_logs')

    op.drop_index(op.f('ix_route_safety_sessions_share_token'), table_name='route_safety_sessions')
    op.drop_index(op.f('ix_route_safety_sessions_user_id'), table_name='route_safety_sessions')
    op.drop_table('route_safety_sessions')

    deviation_enum = postgresql.ENUM(name='route_deviation_state_enum')
    deviation_enum.drop(op.get_bind(), checkfirst=True)

    status_enum = postgresql.ENUM(name='route_safety_status_enum')
    status_enum.drop(op.get_bind(), checkfirst=True)
