import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, paletteColors, Palette, radii, cardShadow } from '../tokens';
import { Icon, IconName } from '../Icon';

export type StatusTone = 'good' | 'warn' | 'bad' | 'off';

const TONE_COLOR: Record<StatusTone, string> = {
  good: colors.success,
  warn: colors.warning,
  bad: colors.emergencyRed,
  off: colors.textMuted,
};

export interface StatusItem {
  key: string;
  icon: IconName;
  title: string;
  value: string;
  tone: StatusTone;
  testID?: string;
}

/**
 * Feature status card (home_screen.dart `_buildArmedFeatureRow`), reused in light and armed palettes.
 * Each row shows ONE system's real state — protection, shake, voice and location are separate.
 */
export const StatusList: React.FC<{ items: StatusItem[]; palette?: Palette }> = ({ items, palette = 'light' }) => {
  const p = paletteColors[palette];
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: p.surface, borderColor: p.border },
        palette === 'light' && cardShadow,
      ]}
    >
      {items.map((item, index) => (
        <View key={item.key}>
          {index > 0 && <View style={[styles.divider, { backgroundColor: p.border }]} />}
          <View style={styles.row} testID={item.testID}>
            <Icon name={item.icon} size={20} color={p.icon} />
            <Text style={[styles.title, { color: p.textPrimary }]}>{item.title}</Text>
            <View style={[styles.dot, { backgroundColor: TONE_COLOR[item.tone] }]} />
            <Text style={[styles.value, { color: p.textSecondary }]}>{item.value}</Text>
          </View>
        </View>
      ))}
    </View>
  );
};

/** Navigation card (ask_sheguard_card.dart). */
export const NavCard: React.FC<{
  icon: IconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}> = ({ icon, title, subtitle, onPress, testID }) => (
  <Pressable
    onPress={onPress}
    testID={testID}
    accessibilityRole="button"
    style={({ pressed }) => [styles.navCard, cardShadow, pressed && styles.pressed]}
  >
    <View style={styles.navTile}>
      <Icon name={icon} size={22} color={colors.white} />
    </View>
    <View style={styles.navText}>
      <Text style={styles.navTitle}>{title}</Text>
      <Text style={styles.navSubtitle}>{subtitle}</Text>
    </View>
    <Icon name="chevron-right" size={24} color={colors.textPrimary} />
  </Pressable>
);

/** Location row (location_status.dart) driven by real readiness. */
export const LocationRow: React.FC<{ label: string; tone: StatusTone; onPress: () => void; dark?: boolean }> = ({
  label,
  tone,
  onPress,
  dark = false,
}) => (
  <Pressable
    onPress={onPress}
    testID="home-location-row"
    accessibilityRole="button"
    style={({ pressed }) => [
      styles.locationRow,
      dark ? { backgroundColor: colors.surfaceDark, borderColor: colors.borderDark } : cardShadow,
      pressed && styles.pressed,
    ]}
  >
    <Icon name="location-on" size={22} color={dark ? colors.white : colors.primaryNavy} />
    <Text style={[styles.locationTitle, { color: dark ? colors.white : colors.textPrimary }]}>Location</Text>
    <View style={[styles.dot, { backgroundColor: TONE_COLOR[tone] }]} />
    <Text style={[styles.locationValue, { color: dark ? colors.textOnDarkSecondary : colors.textSecondary }]}>
      {label}
    </Text>
  </Pressable>
);

const styles = StyleSheet.create({
  card: { borderRadius: radii.card, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  divider: { height: 1, opacity: 0.6 },
  title: { flex: 1, marginLeft: 12, fontSize: 14, fontWeight: '500' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  value: { fontSize: 13, fontWeight: '500' },
  pressed: { opacity: 0.85 },
  navCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  navTile: {
    width: 44,
    height: 44,
    borderRadius: radii.tile,
    backgroundColor: colors.primaryNavy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navText: { flex: 1, marginLeft: 14 },
  navTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  navSubtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  locationTitle: { flex: 1, marginLeft: 10, fontSize: 15, fontWeight: '600' },
  locationValue: { fontSize: 14, fontWeight: '500' },
});
