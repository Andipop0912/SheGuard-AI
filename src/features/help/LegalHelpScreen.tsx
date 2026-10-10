import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Helpline, HelplineCategory, getEnabledHelplines } from '../../helplines/domain/Helpline';
import { dialHelpline } from '../../helplines/dial';
import { colors, radii, spacing, typography } from '../../design/tokens';
import { Icon, IconName } from '../../design/Icon';

const CATEGORY_ICON: Record<HelplineCategory, IconName> = {
  emergency: 'crisis-alert',
  women: 'female',
  legalAid: 'gavel',
  cyberCrime: 'computer',
  child: 'child-care',
};

const CATEGORY_COLOR: Record<HelplineCategory, string> = {
  emergency: colors.emergencyRed,
  women: colors.purpleBadge,
  legalAid: colors.indigo,
  cyberCrime: colors.infoBlue,
  child: colors.success,
};

/**
 * Legal & Emergency Help (Phase 3F). Entirely local: the five verified helplines below ship
 * inside the app, so this screen works with no network, no backend and no sign-in — including
 * in airplane mode. Calling hands off to the phone's own dialer; SheGuard never places the call.
 */
export const LegalHelpScreen: React.FC = () => {
  const helplines = getEnabledHelplines();
  const [sourceFor, setSourceFor] = useState<Helpline | null>(null);
  const [callError, setCallError] = useState<string | null>(null);

  const onCall = async (helpline: Helpline) => {
    setCallError(null);
    const result = await dialHelpline(helpline.id);
    if (!result.ok) {
      setCallError(`Couldn’t open the phone dialer for ${helpline.name}. Dial ${helpline.number} directly.`);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']} testID="legal-help-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Legal & Emergency Help</Text>
        <Text style={styles.subtitle}>Verified Indian government helplines. Works without internet.</Text>

        {callError && (
          <Text style={styles.callError} testID="helpline-call-error">
            {callError}
          </Text>
        )}

        {helplines.map((helpline) => {
          const isEmergency = helpline.category === 'emergency';
          return (
            <View
              key={helpline.id}
              style={[styles.card, isEmergency && styles.cardEmergency]}
              testID={`helpline-card-${helpline.id}`}
            >
              <View style={styles.cardHeader}>
                <View style={[styles.iconCircle, { backgroundColor: CATEGORY_COLOR[helpline.category] }]}>
                  <Icon name={CATEGORY_ICON[helpline.category]} size={22} color={colors.white} />
                </View>
                <View style={styles.cardHeaderText}>
                  <Text style={styles.cardName}>{helpline.name}</Text>
                  <Text style={styles.cardNumber} testID={`helpline-number-${helpline.id}`}>
                    {helpline.number}
                  </Text>
                </View>
              </View>

              <Text style={styles.cardDescription}>{helpline.description}</Text>

              <View style={styles.cardActions}>
                <Pressable
                  style={({ pressed }) => [
                    styles.callButton,
                    isEmergency && styles.callButtonEmergency,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => onCall(helpline)}
                  accessibilityRole="button"
                  accessibilityLabel={`Call ${helpline.name}, ${helpline.number}`}
                  testID={`helpline-call-${helpline.id}`}
                >
                  <Icon name="call" size={18} color={colors.white} />
                  <Text style={styles.callButtonText}>CALL</Text>
                </Pressable>
                <Pressable
                  style={styles.sourceLink}
                  onPress={() => setSourceFor(helpline)}
                  accessibilityRole="button"
                  accessibilityLabel={`Verified information for ${helpline.name}`}
                  testID={`helpline-source-${helpline.id}`}
                >
                  <Icon name="info-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.sourceLinkText}>Verified information</Text>
                </Pressable>
              </View>

              {sourceFor?.id === helpline.id && (
                <View style={styles.sourceBox} testID={`helpline-source-detail-${helpline.id}`}>
                  <Text style={styles.sourceLine}>
                    Last verified: <Text style={styles.sourceValue}>{helpline.verifiedAt}</Text>
                  </Text>
                  <Text style={styles.sourceLine}>
                    Source: <Text style={styles.sourceValue}>{helpline.source.organization}</Text>
                  </Text>
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.footer}>
          <Text style={styles.footerEmergencyTitle}>Emergency? Call 112 immediately.</Text>
          <Text style={styles.footerBody}>SheGuard does not replace emergency services or legal professionals.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.screenHorizontal, paddingBottom: 32 },
  title: { ...typography.screenTitle, color: colors.textPrimary },
  subtitle: { ...typography.cardSubtitle, color: colors.textSecondary, marginTop: 6, marginBottom: 16, lineHeight: 18 },
  callError: { ...typography.body, color: colors.emergencyRedDark, marginBottom: 12 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 14,
  },
  cardEmergency: { borderColor: colors.emergencyRed, borderWidth: 1.5 },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  cardHeaderText: { marginLeft: 12, flex: 1 },
  cardName: { ...typography.cardTitle, color: colors.textPrimary },
  cardNumber: { ...typography.wordmark, fontSize: 20, color: colors.textPrimary, marginTop: 2 },
  cardDescription: { ...typography.cardSubtitle, color: colors.textSecondary, marginTop: 10, lineHeight: 18 },
  cardActions: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 16 },
  callButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primaryNavy,
    borderRadius: radii.pill,
    paddingHorizontal: 20,
    height: 40,
  },
  callButtonEmergency: { backgroundColor: colors.emergencyRed },
  pressed: { opacity: 0.8 },
  callButtonText: { ...typography.button, fontSize: 14, color: colors.white, letterSpacing: 0.5 },
  sourceLink: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sourceLinkText: { ...typography.caption, color: colors.textSecondary },
  sourceBox: {
    marginTop: 12,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radii.tile,
    padding: 12,
  },
  sourceLine: { ...typography.caption, color: colors.textSecondary, lineHeight: 18 },
  sourceValue: { color: colors.textPrimary, fontWeight: '600' },
  footer: {
    marginTop: 8,
    backgroundColor: colors.emergencyRedLight,
    borderRadius: radii.card,
    padding: 16,
  },
  footerEmergencyTitle: { ...typography.cardTitle, color: colors.emergencyRedDark },
  footerBody: { ...typography.cardSubtitle, color: colors.textSecondary, marginTop: 6, lineHeight: 18 },
});
