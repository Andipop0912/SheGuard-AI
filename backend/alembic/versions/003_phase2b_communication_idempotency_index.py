"""Phase 2B Schema: Add uq_event_contact_channel Unique Constraint

Revision ID: 003_phase2b_communication_idempotency_index
Revises: 002_phase2a_trusted_contacts_and_communication_logs
Create Date: 2026-10-04 04:37:00.000000

"""
from typing import Sequence, Union
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '003_phase2b_communication_idempotency_index'
down_revision: Union[str, None] = '002_phase2a_trusted_contacts_and_communication_logs'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

def upgrade() -> None:
    op.create_unique_constraint(
        'uq_event_contact_channel',
        'emergency_communication_logs',
        ['event_id', 'contact_id', 'channel']
    )

def downgrade() -> None:
    op.drop_constraint('uq_event_contact_channel', 'emergency_communication_logs', type_='unique')
