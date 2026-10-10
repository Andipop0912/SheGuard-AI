"""Phase 3D: truthful communication states, bounded attempts, contact soft delete

- communication_status_enum: + NOT_SENT, + UNCERTAIN
- emergency_communication_logs: + reason_code, + attempt_count, + is_simulated
- trusted_contacts: + deleted_at (soft delete keeps communication history)
- trusted_contacts: phones normalized to +91XXXXXXXXXX where unambiguous, then a partial unique
  index on (user_id, phone) for live (not deleted) contacts

Non-destructive. If live duplicates remain after normalization the index creation fails and the
migration stops (resolve the duplicates, then re-run); no row is deleted automatically.

Revision ID: 005_phase3d_communication_truthfulness
Revises: 004_phase2_emergency_locations
Create Date: 2026-10-07 12:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '005_phase3d_communication_truthfulness'
down_revision: Union[str, None] = '004_phase2_emergency_locations'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # PostgreSQL: new enum values must be added outside a transaction block.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE communication_status_enum ADD VALUE IF NOT EXISTS 'NOT_SENT'")
        op.execute("ALTER TYPE communication_status_enum ADD VALUE IF NOT EXISTS 'UNCERTAIN'")

    op.add_column('emergency_communication_logs', sa.Column('reason_code', sa.String(length=64), nullable=True))
    op.add_column(
        'emergency_communication_logs',
        sa.Column('attempt_count', sa.Integer(), nullable=False, server_default='0'),
    )
    op.add_column(
        'emergency_communication_logs',
        sa.Column('is_simulated', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )

    op.add_column('trusted_contacts', sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True))

    # Normalize unambiguous Indian mobile formats to +91XXXXXXXXXX (10 digits starting 6-9).
    op.execute(
        """
        UPDATE trusted_contacts
        SET phone = '+91' || right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)
        WHERE regexp_replace(phone, '[^0-9]', '', 'g') ~ '^(91|0)?[6-9][0-9]{9}$'
        """
    )

    op.create_index(
        'uq_trusted_contacts_user_phone_live',
        'trusted_contacts',
        ['user_id', 'phone'],
        unique=True,
        postgresql_where=sa.text('deleted_at IS NULL'),
    )


def downgrade() -> None:
    op.drop_index('uq_trusted_contacts_user_phone_live', table_name='trusted_contacts')
    op.drop_column('trusted_contacts', 'deleted_at')
    op.drop_column('emergency_communication_logs', 'is_simulated')
    op.drop_column('emergency_communication_logs', 'attempt_count')
    op.drop_column('emergency_communication_logs', 'reason_code')
    # PostgreSQL cannot drop enum values; NOT_SENT / UNCERTAIN remain defined (unused after downgrade).
