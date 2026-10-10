import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useActivationStore } from '../../activation/store/activationStore';
import { ActivationState } from '../../activation/domain/ActivationState';
import { useVoiceStore } from '../../voice/store/voiceStore';
import { useLocationStore } from '../../location/store/locationStore';
import { LocationAvailability } from '../../location/domain/LocationState';
import { useContactsStore } from '../../contacts/store/contactsStore';
import { useAuthStore } from '../../auth/store/authStore';
import { activeCount } from '../../contacts/domain/TrustedContact';
import { AppContainer } from '../../app/di/AppContainer';
import { EvidenceSyncState } from '../../evidence/sync/EvidenceSyncQueue';
import { RouteSafetySession } from '../../routesafety/domain/RouteSafetySession';
import { AccountCard } from '../auth/AccountCard';
import { StatusList, NavCard, StatusTone } from '../../design/components/StatusList';
import { presentProtection, presentShake, presentVoice, presentLocationReadiness } from '../home/statusPresentation';
import { colors, radii, spacing, typography, cardShadow } from '../../design/tokens';
import { Icon } from '../../design/Icon';
import { APP_VERSION } from '../../api/apiConfig';
import { MainTabScreenProps } from '../../navigation/types';

/**
 * Settings (Phase 3L). A control centre over the EXISTING safety systems — ActivationManager,
 * voice, shake, location, trusted contacts, route safety, evidence and the AI assistant. It
 * holds no state of its own and never bypasses EmergencyCoordinator, ARM semantics, or the
 * single-microphone-owner rules: Protection Mode here calls the same arm()/disarm() actions
 * Home uses, nothing is duplicated.
 */
export const SettingsScreen: React.FC<MainTabScreenProps<'Settings'>> = ({ navigation }) => {
  const activationState = useActivationStore((s) => s.activationState);
  const isShakeListening = useActivationStore((s) => s.isShakeListening);
  const arm = useActivationStore((s) => s.arm);
  const disarm = useActivationStore((s) => s.disarm);
  const [toggleBusy, setToggleBusy] = useState(false);

  const voiceState = useVoiceStore((s) => s.voiceState);
  const readiness = useLocationStore((s) => s.readiness);
  const requestLocationPermission = useLocationStore((s) => s.requestPermission);

  const session = useAuthStore((s) => s.session);
  const contacts = useContactsStore((s) => s.contacts);
  const loadContacts = useContactsStore((s) => s.load);

  const [evidenceSync, setEvidenceSync] = useState<EvidenceSyncState | null>(null);
  const [routeSession, setRouteSession] = useState<RouteSafetySession | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (session) loadContacts();
    }, [session, loadContacts])
  );

  useEffect(() => {
    const container = AppContainer.getInstance();
    const unsubEvidence = container.evidenceSyncQueue.subscribe(setEvidenceSync);
    const unsubRoute = container.routeSafetyController.subscribe(setRouteSession);
    return () => {
      unsubEvidence();
      unsubRoute();
    };
  }, []);

  const isArmed = activationState === ActivationState.ACTIVE;
  const protection = presentProtection(activationState);
  const shake = presentShake(isShakeListening);
  const voice = presentVoice(voiceState);
  const location = presentLocationReadiness(readiness);
  const activeContacts = activeCount(contacts);

  const onToggleProtection = useCallback(
    async (on: boolean) => {
      if (toggleBusy) return;
      setToggleBusy(true);
      try {
        if (on) await arm();
        else await disarm();
      } finally {
        setToggleBusy(false);
      }
    },
    [arm, disarm, toggleBusy]
  );

  const needsLocationPermission =
    readiness.availability === LocationAvailability.PERMISSION_REQUIRED ||
    readiness.availability === LocationAvailability.PERMISSION_DENIED;

  const onLocationAction = useCallback(() => {
    if (readiness.availability === LocationAvailability.PERMISSION_DENIED) {
      Linking.openSettings();
    } else if (readiness.availability === LocationAvailability.PERMISSION_REQUIRED) {
      requestLocationPermission();
    } else {
      navigation.navigate('LiveLocation');
    }
  }, [readiness.availability, requestLocationPermission, navigation]);

  const evidenceSyncLabel = (() => {
    if (!evidenceSync) return 'Idle';
    switch (evidenceSync.kind) {
      case 'SYNCING':
        return 'Backing up…';
      case 'NOT_CONNECTED':
        return 'Sign in to back up';
      case 'RETRY_SCHEDULED':
        return `Waiting to back up (${evidenceSync.pending} pending)`;
      case 'IDLE':
      default:
        return evidenceSync.pending > 0 ? `${evidenceSync.pending} pending` : 'Up to date';
    }
  })();

  return (
    <ScrollView style={styles.safe} contentContainerStyle={styles.scroll} testID="settings-screen">
      <Text style={[typography.screenTitle, styles.title]}>Settings</Text>

      <AccountCard onSignIn={() => navigation.navigate('SignIn')} onRegister={() => navigation.navigate('Register')} />
      {session && (
        <Text style={styles.deviceInfo} testID="settings-device-id">
          Device: {session.deviceId}
        </Text>
      )}

      <SectionHeader label="Safety" />
      <SafetyToggleRow
        title="Protection Mode"
        subtitle={isArmed ? 'Shake detection is enabled' : 'Turn on to enable shake detection'}
        value={isArmed}
        onValueChange={onToggleProtection}
        disabled={toggleBusy}
        testID="settings-protection-toggle"
      />
      <View style={styles.gap}>
        <StatusList
          items={[
            { key: 'shake', icon: 'phone-android', title: 'Shake Detection', ...shake, testID: 'settings-status-shake' },
            { key: 'voice', icon: 'mic', title: 'Voice Detection', ...voice, testID: 'settings-status-voice' },
          ]}
        />
      </View>

      <SectionHeader label="Trusted Contacts" />
      <NavCard
        icon="people-alt"
        title="Trusted Contacts"
        subtitle={activeContacts > 0 ? `${activeContacts} active contact${activeContacts === 1 ? '' : 's'}` : 'Add someone to alert in an emergency'}
        onPress={() => navigation.navigate('TrustedContacts')}
        testID="settings-trusted-contacts"
      />

      <SectionHeader label="Location" />
      <StatusRow
        icon="location-on"
        title="Location Access"
        value={location.value}
        tone={location.tone}
        onPress={onLocationAction}
        actionLabel={needsLocationPermission ? 'Fix' : undefined}
        testID="settings-location"
      />

      <SectionHeader label="Route Safety" />
      <NavCard
        icon="route"
        title="Route Safety"
        subtitle={routeSession ? 'Active session' : 'Plan a route and share it live'}
        onPress={() => navigation.navigate('RouteSafety')}
        testID="settings-route-safety"
      />

      <SectionHeader label="Evidence & Privacy" />
      <View style={[styles.infoCard, cardShadow]} testID="settings-evidence-card">
        <View style={styles.infoRow}>
          <Icon name="camera-alt" size={20} color={colors.primaryNavy} />
          <Text style={styles.infoTitle}>Evidence Recording</Text>
        </View>
        <Text style={styles.infoBody}>
          Audio evidence records automatically for the duration of an emergency and stays on this phone. When
          you&apos;re signed in, it also backs up to the cloud and a PDF incident report can be generated from
          History.
        </Text>
        <View style={styles.infoDivider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Cloud backup</Text>
          <Text style={styles.rowValue} testID="settings-evidence-sync-status">{evidenceSyncLabel}</Text>
        </View>
      </View>

      <SectionHeader label="AI Assistant" />
      <NavCard
        icon="chat-bubble-outline"
        title="Ask SheGuard"
        subtitle={Platform.OS === 'android' ? 'AI safety assistant — type or speak your question' : 'AI safety assistant'}
        onPress={() => navigation.navigate('AskSheGuard')}
        testID="settings-ask-sheguard"
      />

      <SectionHeader label="Privacy" />
      <View style={[styles.infoCard, cardShadow]} testID="settings-privacy-card">
        <Text style={styles.infoBody}>
          Emergency events, location fixes and evidence recordings are stored on this phone. When you sign in,
          they also sync to the SheGuard server so trusted contacts can be alerted and your incident history is
          backed up. Ask SheGuard sends what you type or say to Google&apos;s Gemini AI to generate a reply.
        </Text>
      </View>

      <SectionHeader label="App" />
      <NavCard
        icon="shield"
        title="Legal & Emergency Help"
        subtitle="Verified helpline numbers"
        onPress={() => navigation.navigate('LegalHelp')}
        testID="settings-legal-help"
      />
      <View style={[styles.infoCard, cardShadow, styles.gap]} testID="settings-about-card">
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Version</Text>
          <Text style={styles.rowValue}>{APP_VERSION}</Text>
        </View>
        <View style={styles.infoDivider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Build</Text>
          <Text style={styles.rowValue}>{__DEV__ ? 'Development' : 'Release'}</Text>
        </View>
      </View>

      {__DEV__ && (
        <View style={styles.gap}>
          <NavCard
            icon="bug-report"
            title="Developer Diagnostics"
            subtitle="Internal — debug build only"
            onPress={() => navigation.navigate('Diagnostics')}
            testID="settings-diagnostics"
          />
        </View>
      )}
    </ScrollView>
  );
};

const SectionHeader: React.FC<{ label: string }> = ({ label }) => (
  <Text style={styles.sectionHeader}>{label.toUpperCase()}</Text>
);

/** Settings-list variant of the Home Protection toggle — same store, different wording/layout. */
const SafetyToggleRow: React.FC<{
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}> = ({ title, subtitle, value, onValueChange, disabled, testID }) => (
  <View style={[styles.toggleCard, cardShadow]}>
    <View style={[styles.toggleTile, { backgroundColor: value ? colors.success + '26' : colors.emergencyRedLight }]}>
      <Icon name="security" size={22} color={value ? colors.success : colors.emergencyRed} />
    </View>
    <View style={styles.toggleText}>
      <Text style={styles.infoTitle}>{title}</Text>
      <Text style={styles.toggleSubtitle}>{subtitle}</Text>
    </View>
    <Switch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      testID={testID}
      accessibilityLabel={title}
      thumbColor={colors.white}
      trackColor={{ false: colors.switchTrackOff, true: colors.success }}
    />
  </View>
);

const TONE_COLOR: Record<StatusTone, string> = {
  good: colors.success,
  warn: colors.warning,
  bad: colors.emergencyRed,
  off: colors.textMuted,
};

/** A single status row with an optional short action (e.g. "Fix" for a location permission problem). */
const StatusRow: React.FC<{
  icon: React.ComponentProps<typeof Icon>['name'];
  title: string;
  value: string;
  tone: StatusTone;
  onPress: () => void;
  actionLabel?: string;
  testID?: string;
}> = ({ icon, title, value, tone, onPress, actionLabel, testID }) => (
  <View style={[styles.infoCard, cardShadow, styles.statusRowCard]} testID={testID}>
    <Icon name={icon} size={20} color={colors.primaryNavy} />
    <Text style={styles.statusRowTitle}>{title}</Text>
    <View style={[styles.dot, { backgroundColor: TONE_COLOR[tone] }]} />
    <Text style={styles.statusRowValue}>{value}</Text>
    {actionLabel && (
      <Text style={styles.statusRowAction} onPress={onPress} testID={`${testID}-action`}>
        {actionLabel}
      </Text>
    )}
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.screenHorizontal, paddingBottom: 40 },
  title: { color: colors.textPrimary, marginBottom: 16 },
  deviceInfo: { color: colors.textMuted, fontSize: 12, marginTop: -8, marginBottom: 16 },
  gap: { marginTop: 12 },
  sectionHeader: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginTop: 24,
    marginBottom: 10,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  toggleTile: { width: 44, height: 44, borderRadius: radii.tile, alignItems: 'center', justifyContent: 'center' },
  toggleText: { flex: 1, marginLeft: 14, marginRight: 8 },
  toggleSubtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  infoTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  infoBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 8 },
  infoDivider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: colors.textSecondary, fontSize: 13 },
  rowValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  statusRowCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusRowTitle: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  statusRowValue: { color: colors.textSecondary, fontSize: 13, fontWeight: '500' },
  statusRowAction: { color: colors.primaryNavy, fontSize: 13, fontWeight: '700', marginLeft: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
