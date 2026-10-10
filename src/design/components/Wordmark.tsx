import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '../tokens';

/** Logo + "She"/"Guard" wordmark (home_screen.dart top bar). */
export const Wordmark: React.FC<{ dark?: boolean }> = ({ dark = false }) => (
  <View style={styles.row} accessibilityRole="header" accessibilityLabel="SheGuard">
    <Image source={require('../assets/sheguard_shield.png')} style={styles.logo} resizeMode="contain" />
    <Text style={[typography.wordmark, { color: dark ? colors.white : colors.primaryNavy }]}>
      She<Text style={{ color: colors.emergencyRed }}>Guard</Text>
    </Text>
  </View>
);

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  logo: { width: 38, height: 38, marginRight: 8 },
});
