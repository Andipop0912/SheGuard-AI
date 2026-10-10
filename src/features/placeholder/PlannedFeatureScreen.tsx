import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radii, spacing, typography } from '../../design/tokens';
import { Icon } from '../../design/Icon';
import { PlannedFeature, RootStackScreenProps } from '../../navigation/types';

const FEATURES: Record<PlannedFeature, { title: string; phase: string; detail: string }> = {
  settings: { title: 'Settings', phase: '3L', detail: 'Preferences, permissions, appearance and language.' },
  threatAnalysis: { title: 'Threat Analysis', phase: '3I', detail: 'Threat intelligence and analysis.' },
};

/**
 * Truthful placeholder for product areas approved for later Phase 3 steps.
 * Shows no sample data — only what is (not yet) available in this development build.
 */
export const PlannedFeatureContent: React.FC<{
  feature: PlannedFeature;
  onOpenDiagnostics?: () => void;
  /** Real content shown above the placeholder (e.g. the Account card on Settings). */
  header?: React.ReactNode;
}> = ({ feature, onOpenDiagnostics, header }) => {
  const info = FEATURES[feature];
  return (
    <View style={styles.container} testID={`planned-${feature}`}>
      <Text style={[typography.screenTitle, styles.title]}>{info.title}</Text>
      {header}
      <View style={styles.card}>
        <Icon name="construction" size={28} color={colors.textSecondary} />
        <Text style={styles.heading}>Not available in this build yet</Text>
        <Text style={styles.body}>
          {info.detail} Planned for Phase {info.phase}. SOS, voice, shake and location protection work now.
        </Text>
      </View>
      {__DEV__ && onOpenDiagnostics && (
        <Pressable style={styles.devLink} onPress={onOpenDiagnostics} testID="open-diagnostics">
          <Icon name="bug-report" size={18} color={colors.textSecondary} />
          <Text style={styles.devText}>Developer diagnostics</Text>
          <Icon name="chevron-right" size={18} color={colors.textSecondary} />
        </Pressable>
      )}
    </View>
  );
};

export const PlannedFeatureScreen: React.FC<RootStackScreenProps<'Planned'>> = ({ route }) => (
  <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
    <PlannedFeatureContent feature={route.params.feature} />
  </SafeAreaView>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.screenHorizontal },
  title: { color: colors.textPrimary, marginBottom: 16 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    alignItems: 'flex-start',
  },
  heading: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 10 },
  body: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 6 },
  devLink: { flexDirection: 'row', alignItems: 'center', marginTop: 24, paddingVertical: 12, gap: 8 },
  devText: { flex: 1, color: colors.textSecondary, fontSize: 14 },
});
