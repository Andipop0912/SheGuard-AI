/**
 * SheGuard design tokens.
 * Source of truth: SHEGuardflutter/lib/core/theme/app_colors.dart and the widget sources
 * (values transcribed 1:1; additions are marked).
 */
export const colors = {
  // Brand & primary
  primaryNavy: '#0C1E36',
  primaryNavyDark: '#06172A',
  primaryNavyLight: '#1E2D42',

  // Emergency reds
  emergencyRed: '#EC1C3E',
  emergencyRedDark: '#C21832',
  emergencyRedLight: '#FDE8EA',
  emergencyRedGlow: 'rgba(236,28,62,0.20)',
  emergencyRedDeepBg: '#2B0A11',
  /** SOS gradient top stop (sos_button.dart). */
  sosGradientTop: '#FF2E4C',

  // Light surfaces
  background: '#F8F9FE',
  surface: '#FFFFFF',
  surfaceSecondary: '#F1F5F9',
  border: '#E2E8F0',

  // Armed (dark) surfaces
  backgroundDark: '#06172A',
  surfaceDark: '#111E2E',
  surfaceDarkSecondary: '#16263B',
  borderDark: '#1E324A',

  // Emergency screen (emergency_screen.dart / emergency_status_card.dart)
  emergencyScreenBg: '#140508',
  emergencyGlowInner: '#5A0E1A',
  emergencyGlowMid: '#330911',
  emergencyCard: '#1F0E14',
  emergencyCardBorder: '#351822',
  emergencySubtitle: '#E2A0AA',

  // Armed banner
  armedBannerBg: '#063D31',
  armedBannerBorder: '#0D6853',
  armedBannerText: '#6EE7B7',

  // Status & accents
  success: '#10B981',
  successLight: '#DCFCE7',
  successDark: '#064E3B',
  warning: '#F59E0B',
  warningLight: '#FEF3C7',
  warningDark: '#78350F',
  infoBlue: '#2563EB',
  infoBlueLight: '#DBEAFE',
  purpleBadge: '#8B5CF6',
  purpleBadgeLight: '#EDE9FE',
  indigo: '#6366F1',

  // Emergency status badges (emergency_status_card.dart)
  badgeActiveBg: '#0F5132',
  badgeActiveText: '#22C55E',
  badgePendingBg: '#663C00',
  badgePendingText: '#F59E0B',
  badgeNeutralBg: '#2D3748',
  badgeNeutralText: '#CBD5E1',

  // Text
  textPrimary: '#0C1E36',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  textOnDark: '#FFFFFF',
  textOnDarkSecondary: '#CBD5E1',
  textOnDarkMuted: '#94A3B8',

  // Switch track (safety_mode_card.dart)
  switchTrackOff: '#CBD5E1',

  white: '#FFFFFF',
  black: '#000000',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 14,
  xl: 16,
  xxl: 24,
  screenHorizontal: 24,
  emergencyHorizontal: 20,
} as const;

export const radii = {
  tile: 12,
  card: 16,
  emergencyCard: 14,
  pill: 25,
  badge: 10,
} as const;

/** System font; sizes/weights from the Flutter TextStyles. */
export const typography = {
  wordmark: { fontSize: 22, fontWeight: '800' as const, letterSpacing: -0.5 },
  screenTitle: { fontSize: 18, fontWeight: '700' as const },
  cardTitle: { fontSize: 16, fontWeight: '700' as const },
  cardSubtitle: { fontSize: 13, fontWeight: '400' as const },
  body: { fontSize: 14, fontWeight: '500' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  sosLabel: { fontSize: 24, fontWeight: '800' as const, letterSpacing: 1.5 },
  timer: { fontSize: 32, fontWeight: '700' as const, letterSpacing: 1.5 },
  button: { fontSize: 16, fontWeight: '700' as const },
  tabLabel: { fontSize: 12, fontWeight: '600' as const },
} as const;

/** Soft card shadow from the Flutter BoxShadow (black 3%, blur 10, offset 3). */
export const cardShadow = {
  shadowColor: colors.black,
  shadowOpacity: 0.03,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 1,
} as const;

/** Visual context: light (default), armed (dark navy), emergency (burgundy). */
export type Palette = 'light' | 'armed';

export const paletteColors = {
  light: {
    background: colors.background,
    surface: colors.surface,
    border: colors.border,
    textPrimary: colors.textPrimary,
    textSecondary: colors.textSecondary,
    textMuted: colors.textMuted,
    icon: colors.primaryNavy,
    tabBar: colors.white,
  },
  armed: {
    background: colors.backgroundDark,
    surface: colors.surfaceDark,
    border: colors.borderDark,
    textPrimary: colors.textOnDark,
    textSecondary: colors.textOnDarkSecondary,
    textMuted: colors.textOnDarkMuted,
    icon: colors.white,
    tabBar: colors.primaryNavyDark,
  },
} as const;
