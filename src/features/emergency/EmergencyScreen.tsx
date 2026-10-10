import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEmergencyStore } from '../../emergency/store/emergencyStore';
import { isOpenEmergencyState } from '../../emergency/domain/EmergencyState';
import { EmergencyTriggerSource } from '../../emergency/domain/EmergencyTriggerSource';
import { useLocationStore } from '../../location/store/locationStore';
import { useVoiceStore } from '../../voice/store/voiceStore';
import { RootStackScreenProps } from '../../navigation/types';
import { colors, spacing } from '../../design/tokens';
import { Icon } from '../../design/Icon';
import {
  EmergencyHeader,
  EmergencyStatusCard,
  EmergencyTimer,
  ResolveAlertButton,
} from '../../design/components/EmergencyComponents';
import { presentEmergencyLocation, presentTriggerSource } from '../home/statusPresentation';
import { useAuthStore } from '../../auth/store/authStore';
import { useSyncStore } from '../../sync/syncStore';
import { presentEventSync } from '../../sync/syncPresentation';
import { useCommunicationStore } from '../../communication/store/communicationStore';
import { presentContactAlerts } from '../../communication/domain/communicationPresentation';
import { SyncStatus } from '../../emergency/domain/SyncStatus';
import { useEvidenceStore } from '../../evidence/store/evidenceStore';

function formatEvidenceElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Emergency Active (Flutter S4), driven by EmergencyCoordinator's current event.
 * Only real information is shown. Threat analysis is not built yet and is labelled as such —
 * never as analysing. Evidence recording is automatic (EvidenceController); this screen only
 * displays its truthful state.
 */
export const EmergencyScreen: React.FC<RootStackScreenProps<'Emergency'>> = ({ navigation }) => {
  const currentEvent = useEmergencyStore((s) => s.currentEvent);
  const resolveEmergency = useEmergencyStore((s) => s.resolveEmergency);
  const emergencyLocation = useLocationStore((s) => s.emergencyLocation);
  const lastVoicePayload = useVoiceStore((s) => s.lastPayload);
  const allEvents = useEmergencyStore((s) => s.allEvents);
  const session = useAuthStore((s) => s.session);
  const syncSnapshot = useSyncStore();
  const watchCommunication = useCommunicationStore((s) => s.watch);
  const communicationByEvent = useCommunicationStore((s) => s.byEvent);
  const [resolving, setResolving] = useState(false);
  const evidenceCurrent = useEvidenceStore((s) => s.current);
  const evidenceItemsByEvent = useEvidenceStore((s) => s.itemsByEvent);
  const loadEvidenceForEvent = useEvidenceStore((s) => s.loadForEvent);
  const [evidenceElapsedMs, setEvidenceElapsedMs] = useState(0);

  const open = currentEvent && isOpenEmergencyState(currentEvent.state) ? currentEvent : null;
  const openRecord = open ? allEvents.find((e) => e.eventId === open.eventId) ?? open : null;
  const openEventId = open?.eventId ?? null;
  const serverHasEvent = !!session && openRecord?.syncStatus === SyncStatus.SYNCED;

  // Alert status is read from the server only once it holds this emergency, and only while this
  // screen is showing it. The server sends the alerts; nothing here can delay or block the SOS.
  useEffect(() => {
    if (!openEventId || !serverHasEvent) return undefined;
    return watchCommunication(openEventId);
  }, [openEventId, serverHasEvent, watchCommunication]);

  const onResolve = useCallback(async () => {
    if (!open) return;
    setResolving(true);
    try {
      await resolveEmergency(open.eventId);
    } finally {
      setResolving(false);
    }
  }, [open, resolveEmergency]);

  useEffect(() => {
    if (openEventId) loadEvidenceForEvent(openEventId);
  }, [openEventId, loadEvidenceForEvent]);

  const evidenceIsRecordingThisEvent = evidenceCurrent?.eventId === openEventId && evidenceCurrent?.status === 'RECORDING';
  const evidenceStartedAt = evidenceIsRecordingThisEvent ? evidenceCurrent?.recordingStartedAt ?? null : null;

  useEffect(() => {
    if (!evidenceStartedAt) {
      setEvidenceElapsedMs(0);
      return undefined;
    }
    const id = setInterval(() => setEvidenceElapsedMs(Date.now() - evidenceStartedAt), 500);
    return () => clearInterval(id);
  }, [evidenceStartedAt]);

  const goBack = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('MainTabs', { screen: 'Home' }));

  if (!open) {
    return (
      <SafeAreaView style={styles.safe} testID="emergency-none">
        <Text style={styles.noneText}>No active emergency.</Text>
        <Pressable onPress={goBack} style={styles.noneButton}>
          <Text style={styles.noneButtonText}>Back to Home</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const voicePhrase =
    open.triggerSource === EmergencyTriggerSource.VOICE && lastVoicePayload ? lastVoicePayload.keywordDetected : null;
  // Sync fields come from the stored record (the sync service updates storage, not the coordinator).
  const record = allEvents.find((e) => e.eventId === open.eventId) ?? open;
  const sync = presentEventSync(record, session, syncSnapshot);
  const communication = communicationByEvent[open.eventId];
  const contactAlerts = presentContactAlerts({
    signedIn: !!session,
    eventSyncStatus: record.syncStatus,
    records: communication?.records ?? null,
    activeContactCount: communication?.activeContactCount ?? null,
    fetchFailed: communication?.fetchFailed ?? false,
  });
  const location = presentEmergencyLocation(
    emergencyLocation && emergencyLocation.eventId === open.eventId ? emergencyLocation : null,
    Date.now()
  );

  return (
    <View style={styles.safe} testID="emergency-screen">
      <StatusBar barStyle="light-content" backgroundColor={colors.emergencyScreenBg} />
      {/* Radial glow behind the header, approximated with layered translucent circles. */}
      <View pointerEvents="none" style={styles.glowWrap}>
        <View style={[styles.glow, styles.glowOuter]} />
        <View style={[styles.glow, styles.glowInner]} />
      </View>

      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.appBar}>
          <Pressable onPress={goBack} hitSlop={12} accessibilityLabel="Back" testID="emergency-back">
            <Icon name="arrow-back" size={24} color={colors.white} />
          </Pressable>
          <View style={styles.appBarText}>
            <Text style={styles.appBarTitle}>Emergency Active</Text>
            <Text style={styles.appBarSubtitle}>{sync.confirmed ? 'Backed up to server' : 'Recorded on this phone'}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <EmergencyHeader title="EMERGENCY ACTIVE" subtitle="Your emergency is saved on this phone" />
          <View style={styles.timer}>
            <EmergencyTimer startedAt={open.createdAt} />
          </View>

          <EmergencyStatusCard
            testID="card-trigger"
            icon="graphic-eq"
            iconBackground={colors.emergencyRed}
            title="Alert Triggered By"
            status={presentTriggerSource(open.triggerSource, voicePhrase)}
          />
          <View style={styles.gap} />
          <Pressable
            onPress={() => navigation.navigate('LiveLocation')}
            accessibilityRole="button"
            accessibilityLabel="Open live location map"
            testID="card-location-open-map"
          >
            <EmergencyStatusCard
              testID="card-location"
              icon="location-on"
              iconBackground={colors.success}
              title="Location"
              status={location.status}
              badge={location.badge}
            />
          </Pressable>
          <View style={styles.gap} />
          <EmergencyStatusCard
            testID="card-contacts"
            icon="people-alt"
            iconBackground={colors.infoBlue}
            title="Trusted Contacts"
            status={contactAlerts.status}
            badge={contactAlerts.badge}
          />
          <View style={styles.gap} />
          <EmergencyStatusCard
            testID="card-evidence"
            icon="camera-alt"
            iconBackground={colors.purpleBadge}
            title="Evidence Collection"
            status={
              evidenceIsRecordingThisEvent
                ? `Recording audio evidence — ${formatEvidenceElapsed(evidenceElapsedMs)}`
                : evidenceCurrent?.eventId === open.eventId && evidenceCurrent?.status === 'UNAVAILABLE'
                ? `Audio evidence unavailable${evidenceCurrent.unavailableReason ? ` — ${evidenceCurrent.unavailableReason}` : ''}`
                : (evidenceItemsByEvent[open.eventId]?.length ?? 0) > 0
                ? `${evidenceItemsByEvent[open.eventId].length} audio recording(s) saved on this phone`
                : 'Starting automatically with this emergency'
            }
            badge={evidenceIsRecordingThisEvent ? { text: 'Recording', tone: 'active' } : { text: 'Auto', tone: 'neutral' }}
          />
          <View style={styles.gap} />
          <EmergencyStatusCard
            testID="card-threat"
            icon="shield"
            iconBackground={colors.indigo}
            title="Threat Analysis"
            status="Not analysed — threat analysis is not available yet"
            badge={{ text: 'Off', tone: 'neutral' }}
          />
          <View style={styles.gap} />
          <EmergencyStatusCard
            testID="card-sync"
            icon={sync.confirmed ? 'cloud-done' : sync.badge.tone === 'pending' ? 'cloud-upload' : 'cloud-off'}
            iconBackground={sync.confirmed ? colors.success : colors.badgeNeutralBg}
            title="Server"
            status={sync.status}
            badge={sync.badge}
          />

          <View style={styles.resolve}>
            <ResolveAlertButton onResolve={onResolve} disabled={resolving} />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.emergencyScreenBg },
  flex: { flex: 1 },
  glowWrap: { position: 'absolute', top: -60, left: 0, right: 0, height: 380, alignItems: 'center' },
  glow: { position: 'absolute', borderRadius: 400 },
  glowOuter: { top: 0, width: 520, height: 380, backgroundColor: colors.emergencyGlowMid, opacity: 0.55 },
  glowInner: { top: 70, width: 300, height: 220, backgroundColor: colors.emergencyGlowInner, opacity: 0.6 },
  appBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 },
  appBarText: { marginLeft: 16 },
  appBarTitle: { color: colors.white, fontSize: 18, fontWeight: '700' },
  appBarSubtitle: { color: colors.emergencySubtitle, fontSize: 13 },
  content: { paddingHorizontal: spacing.emergencyHorizontal, paddingTop: 12, paddingBottom: 20 },
  timer: { marginTop: 14, marginBottom: 24 },
  gap: { height: 10 },
  resolve: { marginTop: 24 },
  noneText: { color: colors.white, fontSize: 16, textAlign: 'center', marginTop: 80 },
  noneButton: { alignSelf: 'center', marginTop: 16, padding: 12 },
  noneButtonText: { color: colors.emergencySubtitle, fontSize: 15, fontWeight: '600' },
});
