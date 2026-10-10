import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { cardShadow, colors, radii, typography } from '../tokens';
import { Icon } from '../Icon';

interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

/**
 * Unarmed protection card (safety_mode_card.dart).
 * Wording corrected (approved): protection controls SHAKE only; voice is independent.
 */
export const ProtectionModeCard: React.FC<ToggleProps> = ({ value, onValueChange, disabled, testID }) => (
  <View style={[styles.card, cardShadow]}>
    <View style={[styles.tile, { backgroundColor: colors.emergencyRedLight }]}>
      <Icon name="shield" size={24} color={colors.emergencyRed} />
    </View>
    <View style={styles.text}>
      <Text style={[typography.cardTitle, { color: colors.textPrimary }]}>Protection Mode</Text>
      <Text style={[typography.cardSubtitle, styles.subtitle, { color: colors.textSecondary }]}>
        Turn on to enable shake detection
      </Text>
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      testID={testID}
      accessibilityLabel="Protection Mode"
      thumbColor={colors.white}
      trackColor={{ false: colors.switchTrackOff, true: colors.emergencyRed }}
    />
  </View>
);

interface ArmedBannerProps extends ToggleProps {
  armedAt: number | null;
  shakeEnabled: boolean;
}

function formatClock(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

/** Armed banner (home_screen.dart armed state). "Armed at" comes from the real ARM time. */
export const ArmedBanner: React.FC<ArmedBannerProps> = ({ value, onValueChange, disabled, testID, armedAt, shakeEnabled }) => (
  <View style={styles.banner} testID="armed-banner">
    <View style={styles.bannerIcon}>
      <Icon name="verified-user" size={26} color={colors.success} />
    </View>
    <View style={styles.text}>
      <Text style={styles.bannerTitle}>Protection Mode Active</Text>
      <Text style={styles.bannerLine}>{shakeEnabled ? 'Shake detection enabled' : 'Shake detection starting…'}</Text>
      {armedAt !== null && <Text style={[styles.bannerLine, styles.bannerTime]}>Armed at {formatClock(armedAt)}</Text>}
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      testID={testID}
      accessibilityLabel="Protection Mode"
      thumbColor={colors.white}
      trackColor={{ false: colors.switchTrackOff, true: colors.success }}
    />
  </View>
);

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  tile: { width: 44, height: 44, borderRadius: radii.tile, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, marginLeft: 14, marginRight: 8 },
  subtitle: { marginTop: 3 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.armedBannerBg,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderColor: colors.armedBannerBorder,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  bannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(16,185,129,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTitle: { color: colors.white, fontSize: 16, fontWeight: '700' },
  bannerLine: { color: colors.armedBannerText, fontSize: 12, marginTop: 2 },
  bannerTime: { fontWeight: '500' },
});
