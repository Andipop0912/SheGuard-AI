import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEmergencyStore } from '../../emergency/store/emergencyStore';
import { AppContainer } from '../../app/di/AppContainer';
import { EmergencyLocationStatus } from '../../location/domain/LocationState';
import { colors, radii, spacing, typography, cardShadow } from '../../design/tokens';
import { Icon } from '../../design/Icon';
import { RootStackScreenProps } from '../../navigation/types';
import { formatDate, formatEmergencyState, formatSyncStatus, formatTriggerSource } from './HistoryScreen';
import { isOpenEmergencyState } from '../../emergency/domain/EmergencyState';
import { useEvidenceStore } from '../../evidence/store/evidenceStore';
import { EvidenceItem, EvidenceSyncStatus } from '../../evidence/domain/EvidenceItem';
import { EvidencePlaybackModule } from '../../evidence/native/EvidencePlaybackBridge';
import { EvidenceDownloadModule } from '../../evidence/native/EvidenceDownloadBridge';

function formatEvidenceDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const IncidentDetailsScreen: React.FC<RootStackScreenProps<'IncidentDetails'>> = ({ route, navigation }) => {
  const { eventId } = route.params;
  const allEvents = useEmergencyStore((s) => s.allEvents);
  const event = allEvents.find((e) => e.eventId === eventId);
  const [locationAvailable, setLocationAvailable] = useState<boolean | null>(null);
  const evidenceItems = useEvidenceStore((s) => s.itemsByEvent[eventId]) ?? [];
  const loadEvidenceForEvent = useEvidenceStore((s) => s.loadForEvent);

  const [playingId, setPlayingId] = useState<string | null>(null);
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [reportBusy, setReportBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const playback = useRef(new EvidencePlaybackModule()).current;
  const downloader = useRef(new EvidenceDownloadModule()).current;

  const audioFileName = (item: EvidenceItem) => `SheGuard-Evidence-${item.evidenceId}.m4a`;

  const onPlayPress = async (item: EvidenceItem) => {
    if (playingId === item.evidenceId) {
      await playback.stop();
      return; // the in-flight play() promise below resolves and clears playingId
    }
    if (playingId) await playback.stop();
    setPlayingId(item.evidenceId);
    setStatusMessage(null);
    try {
      await playback.play(item.filePath);
    } catch {
      if (item.syncStatus === EvidenceSyncStatus.UPLOADED) {
        try {
          const url = await AppContainer.getInstance().evidenceApiClient.getEvidenceDownloadUrl(item.evidenceId);
          if (!url) throw new Error('no cloud copy');
          await playback.play(url);
        } catch {
          setStatusMessage('Could not play this recording.');
        }
      } else {
        setStatusMessage('Could not play this recording.');
      }
    } finally {
      setPlayingId((current) => (current === item.evidenceId ? null : current));
    }
  };

  const onDownloadPress = async (item: EvidenceItem) => {
    setDownloadingIds((prev) => new Set(prev).add(item.evidenceId));
    setStatusMessage(null);
    try {
      try {
        await downloader.saveLocalFile(item.filePath, audioFileName(item), 'audio/m4a');
        setStatusMessage('Recording saved to Downloads.');
      } catch (localErr) {
        if (item.syncStatus !== EvidenceSyncStatus.UPLOADED) throw localErr;
        const url = await AppContainer.getInstance().evidenceApiClient.getEvidenceDownloadUrl(item.evidenceId);
        if (!url) throw localErr;
        await downloader.downloadUrl(url, audioFileName(item), 'audio/m4a');
        setStatusMessage('Recording saved to Downloads.');
      }
    } catch {
      setStatusMessage('Could not download this recording.');
    } finally {
      setDownloadingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.evidenceId);
        return next;
      });
    }
  };

  const onDownloadReportPress = async () => {
    setReportBusy(true);
    setStatusMessage(null);
    try {
      const result = await AppContainer.getInstance().evidenceApiClient.generateReport(eventId);
      if (!result?.url) {
        setStatusMessage('Incident report could not be generated.');
        return;
      }
      await downloader.downloadUrl(result.url, `SheGuard-Incident-Report-${eventId}.pdf`, 'application/pdf');
      setStatusMessage('Incident report saved to Downloads.');
    } catch {
      setStatusMessage('Incident report could not be generated.');
    } finally {
      setReportBusy(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    AppContainer.getInstance().emergencyLocationRepository.getSummary(eventId).then(summary => {
      if (mounted) {
        setLocationAvailable(summary?.status === EmergencyLocationStatus.AVAILABLE || summary?.status === EmergencyLocationStatus.STALE);
      }
    });
    return () => { mounted = false; };
  }, [eventId]);

  useEffect(() => {
    loadEvidenceForEvent(eventId);
  }, [eventId, loadEvidenceForEvent]);

  if (!event) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>Incident not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isActive = isOpenEmergencyState(event.state);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']} testID="incident-details-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Icon name="history" size={24} color={colors.primaryNavy} />
            <Text style={styles.title}>Incident Details</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>ID</Text>
            <Text style={styles.value} testID="incident-id">{event.eventId}</Text>
          </View>
          
          <View style={styles.divider} />
          
          <View style={styles.row}>
            <Text style={styles.label}>Trigger Source</Text>
            <Text style={styles.value} testID="incident-source">{formatTriggerSource(event.triggerSource)}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Created At</Text>
            <Text style={styles.value} testID="incident-created">{formatDate(event.createdAt)}</Text>
          </View>

          {event.resolvedAt ? (
            <>
              <View style={styles.divider} />
              <View style={styles.row}>
                <Text style={styles.label}>Resolved At</Text>
                <Text style={styles.value} testID="incident-resolved">{formatDate(event.resolvedAt)}</Text>
              </View>
            </>
          ) : null}

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Status</Text>
            <Text style={[styles.value, isActive && styles.valActive]} testID="incident-state">{formatEmergencyState(event.state)}</Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Location</Text>
            <Text style={styles.value} testID="incident-location">
              {locationAvailable === true ? 'Location available' : locationAvailable === false ? 'Location unavailable' : 'Checking...'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.row}>
            <Text style={styles.label}>Sync Status</Text>
            <Text style={styles.value} testID="incident-sync">{formatSyncStatus(event.syncStatus)}</Text>
          </View>
        </View>

        <View style={[styles.card, styles.cardSpacing]} testID="incident-evidence-card">
          <View style={styles.header}>
            <Icon name="camera-alt" size={22} color={colors.primaryNavy} />
            <Text style={styles.title}>Evidence</Text>
          </View>
          {evidenceItems.length === 0 ? (
            <Text style={styles.value}>No evidence recorded</Text>
          ) : (
            evidenceItems.map((item, index) => {
              const isPlaying = playingId === item.evidenceId;
              const isDownloading = downloadingIds.has(item.evidenceId);
              return (
                <React.Fragment key={item.evidenceId}>
                  {index > 0 && <View style={styles.divider} />}
                  <View style={styles.row}>
                    <Text style={styles.label}>Audio recording — {formatDate(item.createdAt)}</Text>
                    <Text style={styles.value} testID={`incident-evidence-${index}`}>
                      Duration {formatEvidenceDuration(item.durationMs)} ·{' '}
                      {item.syncStatus === EvidenceSyncStatus.UPLOADED ? 'Backed up to cloud' : 'Saved on this phone'}
                    </Text>
                    <View style={styles.evidenceActions}>
                      <Pressable
                        style={styles.evidenceActionButton}
                        onPress={() => onPlayPress(item)}
                        accessibilityRole="button"
                        testID={`incident-evidence-play-${index}`}
                      >
                        <Icon name={isPlaying ? 'stop' : 'play-arrow'} size={18} color={colors.primaryNavy} />
                        <Text style={styles.evidenceActionText}>{isPlaying ? 'Stop' : 'Play'}</Text>
                      </Pressable>
                      <Pressable
                        style={styles.evidenceActionButton}
                        onPress={() => onDownloadPress(item)}
                        disabled={isDownloading}
                        accessibilityRole="button"
                        testID={`incident-evidence-download-${index}`}
                      >
                        {isDownloading ? (
                          <ActivityIndicator size="small" color={colors.primaryNavy} />
                        ) : (
                          <Icon name="file-download" size={18} color={colors.primaryNavy} />
                        )}
                        <Text style={styles.evidenceActionText}>Download</Text>
                      </Pressable>
                    </View>
                  </View>
                </React.Fragment>
              );
            })
          )}
          {statusMessage ? (
            <Text style={styles.statusMessage} testID="incident-evidence-status">{statusMessage}</Text>
          ) : null}
        </View>

        <Pressable
          style={styles.reportButton}
          accessibilityRole="button"
          testID="incident-generate-report"
          onPress={() => navigation.navigate('IncidentReport', { eventId })}
        >
          <Icon name="shield" size={18} color={colors.white} />
          <Text style={styles.reportButtonText}>Generate Incident Report</Text>
        </Pressable>

        <Pressable
          style={[styles.reportButton, styles.pdfButton]}
          accessibilityRole="button"
          testID="incident-download-pdf-report"
          onPress={onDownloadReportPress}
          disabled={reportBusy}
        >
          {reportBusy ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Icon name="picture-as-pdf" size={18} color={colors.white} />
          )}
          <Text style={styles.reportButtonText}>{reportBusy ? 'Generating...' : 'Download PDF Report'}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.screenHorizontal, paddingBottom: 40 },
  
  errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  errorText: { fontSize: 16, color: colors.textSecondary },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    ...cardShadow,
  },
  cardSpacing: { marginTop: 16 },
  reportButton: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primaryNavy,
    borderRadius: radii.card,
    paddingVertical: 14,
  },
  reportButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  pdfButton: { marginTop: 12, backgroundColor: colors.primaryNavyDark },
  evidenceActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  evidenceActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  evidenceActionText: { fontSize: 13, fontWeight: '600', color: colors.primaryNavy },
  statusMessage: { marginTop: 12, fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  title: { fontSize: 20, fontWeight: '700', color: colors.textPrimary },
  
  row: { flexDirection: 'column', gap: 4, paddingVertical: 8 },
  label: { fontSize: 13, color: colors.textMuted },
  value: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  valActive: { color: colors.emergencyRed },

  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
});
