/** Wire format of backend/app/schemas/auth.py (camelCase, as verified in the Phase 3C audit). */

export interface RegisterRequestDto {
  phone: string;
  password: string;
  deviceId: string;
  platform: 'android';
  osVersion: string | null;
  appVersion: string | null;
}

export interface LoginRequestDto {
  phone: string;
  password: string;
  deviceId: string;
}

export interface RefreshRequestDto {
  refreshToken: string;
  deviceId: string;
}

export interface LogoutRequestDto {
  refreshToken: string;
}

export interface TokenResponseDto {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  userId: string;
  deviceId: string;
}

export function isTokenResponse(value: unknown): value is TokenResponseDto {
  const v = value as Partial<TokenResponseDto> | null;
  return (
    !!v &&
    typeof v.accessToken === 'string' &&
    v.accessToken.length > 0 &&
    typeof v.refreshToken === 'string' &&
    v.refreshToken.length > 0 &&
    typeof v.userId === 'string' &&
    v.userId.length > 0 &&
    typeof v.deviceId === 'string'
  );
}
