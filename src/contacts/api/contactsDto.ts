import { TrustedContact, TrustedContactInput } from '../domain/TrustedContact';

/** Wire format of backend/app/schemas/contact.py (snake_case, as the backend defines it). */
export interface TrustedContactDto {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relationship: string | null;
  priority: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrustedContactWriteDto {
  name?: string;
  phone?: string;
  relationship?: string | null;
  priority?: number;
  is_active?: boolean;
}

export function fromContactDto(dto: TrustedContactDto): TrustedContact {
  return {
    id: dto.id,
    name: dto.name,
    phone: dto.phone,
    relationship: dto.relationship ?? null,
    priority: dto.priority,
    isActive: dto.is_active,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function toContactWriteDto(input: Partial<TrustedContactInput>): TrustedContactWriteDto {
  const dto: TrustedContactWriteDto = {};
  if (input.name !== undefined) dto.name = input.name.trim();
  if (input.phone !== undefined) dto.phone = input.phone;
  if (input.relationship !== undefined) dto.relationship = input.relationship?.trim() || null;
  if (input.priority !== undefined) dto.priority = input.priority;
  if (input.isActive !== undefined) dto.is_active = input.isActive;
  return dto;
}

export function isContactDto(value: unknown): value is TrustedContactDto {
  const v = value as Partial<TrustedContactDto> | null;
  return (
    !!v &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.phone === 'string' &&
    typeof v.priority === 'number' &&
    typeof v.is_active === 'boolean'
  );
}
