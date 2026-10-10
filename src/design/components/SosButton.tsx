import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../tokens';
import { Icon } from '../Icon';

export type SosButtonState = 'idle' | 'triggering' | 'active';

interface SosButtonProps {
  onPress: () => void;
  dark?: boolean;
  state?: SosButtonState;
  testID?: string;
}

const CAPTION: Record<SosButtonState, string> = {
  idle: 'Tap to send emergency alert',
  triggering: 'Sending SOS…',
  active: 'Emergency active — tap to view',
};

/**
 * SOS button (sos_button.dart): concentric halo 210/178/148, red gradient, crisis icon.
 * The 3-stop vertical gradient is approximated with layered views (no SVG dependency).
 * Never disabled: pressing again while active only opens the emergency.
 */
export const SosButton: React.FC<SosButtonProps> = ({ onPress, dark = false, state = 'idle', testID }) => (
  <View style={styles.column}>
    <View style={[styles.haloOuter, { backgroundColor: dark ? 'rgba(236,28,62,0.10)' : '#FFF1F2' }]}>
      <View style={[styles.haloInner, { backgroundColor: dark ? 'rgba(236,28,62,0.18)' : '#FDE8EA' }]}>
        <Pressable
          onPress={onPress}
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={state === 'active' ? 'Emergency active, open emergency' : 'Send SOS emergency alert'}
          style={({ pressed }) => [
            styles.button,
            { shadowOpacity: dark ? 0.5 : 0.3 },
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.gradientTop} />
          <View style={styles.gradientBottom} />
          <Icon name="crisis-alert" size={38} color={colors.white} />
          <Text style={styles.label}>SOS</Text>
        </Pressable>
      </View>
    </View>
    <Text style={[styles.caption, { color: dark ? colors.textOnDarkSecondary : colors.textSecondary }]}>
      {CAPTION[state]}
    </Text>
  </View>
);

const styles = StyleSheet.create({
  column: { alignItems: 'center' },
  haloOuter: { width: 210, height: 210, borderRadius: 105, alignItems: 'center', justifyContent: 'center' },
  haloInner: { width: 178, height: 178, borderRadius: 89, alignItems: 'center', justifyContent: 'center' },
  button: {
    width: 148,
    height: 148,
    borderRadius: 74,
    overflow: 'hidden',
    backgroundColor: colors.emergencyRed,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.emergencyRed,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  gradientTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: colors.sosGradientTop,
    opacity: 0.55,
  },
  gradientBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '35%',
    backgroundColor: colors.emergencyRedDark,
    opacity: 0.55,
  },
  pressed: { transform: [{ scale: 0.97 }] },
  label: { ...typography.sosLabel, color: colors.white, marginTop: 4 },
  caption: { marginTop: 14, fontSize: 13, fontWeight: '500', letterSpacing: 0.2 },
});
