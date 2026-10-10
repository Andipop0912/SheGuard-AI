"""Phase 2 Location Schema: emergency_locations

Revision ID: 004_phase2_emergency_locations
Revises: 003_phase2b_communication_idempotency_index
Create Date: 2026-10-06 21:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from app.db.models.guid import GUID

# revision identifiers, used by Alembic.
revision: str = '004_phase2_emergency_locations'
down_revision: Union[str, None] = '003_phase2b_communication_idempotency_index'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

location_kind_enum = sa.Enum('SNAPSHOT', 'UPDATE', name='emergency_location_kind_enum')


def upgrade() -> None:
    op.create_table(
        'emergency_locations',
        sa.Column('id', GUID(), primary_key=True, nullable=False),
        sa.Column('location_id', sa.String(length=64), nullable=False),
        sa.Column('event_id', sa.String(length=64),
                  sa.ForeignKey('emergency_events.event_id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', GUID(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('device_id', sa.String(length=64), nullable=False),
        sa.Column('kind', location_kind_enum, nullable=False),
        sa.Column('latitude', sa.Float(), nullable=False),
        sa.Column('longitude', sa.Float(), nullable=False),
        sa.Column('accuracy_m', sa.Float(), nullable=True),
        sa.Column('altitude_m', sa.Float(), nullable=True),
        sa.Column('speed_mps', sa.Float(), nullable=True),
        sa.Column('heading_deg', sa.Float(), nullable=True),
        sa.Column('provider', sa.String(length=20), nullable=False),
        sa.Column('is_last_known', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('captured_at', sa.BigInteger(), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint('location_id', name='uq_emergency_locations_location_id'),
    )
    op.create_index('ix_emergency_locations_user_id', 'emergency_locations', ['user_id'])
    op.create_index('ix_emergency_locations_event_captured', 'emergency_locations', ['event_id', 'captured_at'])


def downgrade() -> None:
    op.drop_index('ix_emergency_locations_event_captured', table_name='emergency_locations')
    op.drop_index('ix_emergency_locations_user_id', table_name='emergency_locations')
    op.drop_table('emergency_locations')
    location_kind_enum.drop(op.get_bind(), checkfirst=True)
