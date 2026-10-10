import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEmergencyStore } from '../../emergency/store/emergencyStore';
import { useEvidenceStore } from '../../evidence/store/evidenceStore';
import { useCommunicationStore } from '../../communication/store/communicationStore';
import { useAuthStore } from '../../auth/store/authStore';
import { AppContainer } from '../../app/di/AppContainer';
import { EmergencyLocationSummary } from '../../location/storage/EmergencyLocationRepository';
import { SyncStatus } from '../../emergency/domain/SyncStatus';
import { generateIncidentReport } from '../../history/report/IncidentReportGenerator';
import { RootStackScreenProps } from '../../navigation/types';
import { colors, radii, spacing, cardShadow } from '../../design/tokens';
import { Icon } from '../../design/Icon';
import { Pressable } from 'react-native';

/**
 * A factual report for one incident (Part 6/7): generated only from data the app already
 * stored (the event, its location summary, server communication records if available, and
 * local evidence). Nothing here is invented — missing data is labelled as missing.
 */
export const IncidentReportScreen: React.FC<RootStackScreenProps<'IncidentReport'>> = ({ route }) => {
  const { eventId } = route.params;
  const event = useEmergencyStore((s) => s.allEvents.find((e) => e.eventId === eventId));
  const evidenceItems = useEvidenceStore((s) => s.itemsByEvent[eventId]) ?? [];
  const loadEvidenceForEvent = useEvidenceStore((s) => s.loadForEvent);
  const session = useAuthStore((s) => s.session);
  const watchCommunication = useCommunicationStore((s) => s.watch);
  const communicationSnapshot = useCommunicationStore((s) => s.byEvent[eventId]);
  const [locationSummary, setLocationSummary] = useState<EmergencyLocationSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  const serverHasEvent = !!session && event?.syncStatus === SyncStatus.SYNCED;

  useEffect(() => {
    loadEvidenceForEvent(eventId);
  }, [eventId, loadEvidenceForEvent]);

  useEffect(() => {
    let mounted = true;
    AppContainer.getInstance()
      .emergencyLocationRepository.getSummary(eventId)
      .then((summary) => {
        if (mounted) {
          setLocationSummary(summary);
          setLoaded(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, [eventId]);

  useEffect(() => {
    if (!serverHasEvent) return undefined;
    return watchCommunication(eventId);
  }, [eventId, serverHasEvent, watchCommunication]);

  const report = useMemo(() => {
    if (!event || !loaded) return null;
    return generateIncidentReport({
      event,
      locationSummary,
      communication: serverHasEvent ? communicationSnapshot?.records ?? null : null,
      evidence: evidenceItems,
    });
  }, [event, loaded, locationSummary, serverHasEvent, communicationSnapshot, evidenceItems]);

  const onDownload = async () => {
    if (!report) return;
    const shortId = report.incidentId.slice(0, 8);
    const filename = `SheGuard_Incident_${shortId}_Report_${report.generatedAt}.txt`;
    try {
      await Share.share({ title: filename, message: report.text });
    } catch {
      // The user cancelled or no share target was available; the report stays visible on screen.
    }
  };

  if (!event) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.errorText}>Incident not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']} testID="incident-report-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        {!report ? (
          <Text style={styles.value}>Loading…</Text>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.header}>
                <Icon name="shield" size={22} color={colors.primaryNavy} />
                <Text style={styles.title}>Incident Report</Text>
              </View>
              <Text style={styles.monoBlock} testID="incident-report-text" selectable>
                {report.text}
              </Text>
            </View>

            <Pressable style={styles.downloadButton} accessibilityRole="button" testID="incident-report-download" onPress={onDownload}>
              <Icon name="cloud-upload" size={18} color={colors.white} />
              <Text style={styles.downloadButtonText}>Download / Share Report</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.screenHorizontal, paddingBottom: 40 },
  errorText: { fontSize: 16, color: colors.textSecondary, textAlign: 'center', marginTop: 80 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    ...cardShadow,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  value: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  monoBlock: { fontSize: 12, fontFamily: 'monospace', color: colors.textPrimary, lineHeight: 18 },
  downloadButton: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primaryNavy,
    borderRadius: radii.card,
    paddingVertical: 14,
  },
  downloadButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
