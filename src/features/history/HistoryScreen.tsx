import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEmergencyStore } from '../../emergency/store/emergencyStore';
import { EmergencyEvent } from '../../emergency/domain/EmergencyEvent';
import { EmergencyTriggerSource } from '../../emergency/domain/EmergencyTriggerSource';
import { SyncStatus } from '../../emergency/domain/SyncStatus';
import { EmergencyState, isOpenEmergencyState } from '../../emergency/domain/EmergencyState';
import { AppContainer } from '../../app/di/AppContainer';
import { EmergencyLocationStatus } from '../../location/domain/LocationState';
import { colors, radii, spacing, typography, cardShadow } from '../../design/tokens';
import { Icon } from '../../design/Icon';
import { MainTabScreenProps } from '../../navigation/types';

export function formatTriggerSource(source: EmergencyTriggerSource): string {
  switch (source) {
    case EmergencyTriggerSource.MANUAL_SOS: return 'Manual SOS';
    case EmergencyTriggerSource.VOICE: return 'Voice SOS';
    case EmergencyTriggerSource.GESTURE: return 'Shake SOS';
    case EmergencyTriggerSource.HARDWARE_BUTTON: return 'Hardware Button';
    case EmergencyTriggerSource.SYSTEM: return 'System Trigger';
    default: return source;
  }
}

export function formatEmergencyState(state: EmergencyState): string {
  switch (state) {
    case EmergencyState.RESOLVED: return 'Resolved';
    case EmergencyState.CANCELLED: return 'Cancelled';
    default: return 'Active';
  }
}

export function formatSyncStatus(status: SyncStatus): string {
  switch (status) {
    case SyncStatus.SYNCED: return 'Synced';
    case SyncStatus.FAILED: return 'Failed';
    case SyncStatus.PENDING: return 'Pending';
    case SyncStatus.LOCAL_ONLY: return 'Local';
    default: return status;
  }
}

export const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' \u00B7 ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const HistoryCard: React.FC<{ event: EmergencyEvent; onPress: () => void }> = ({ event, onPress }) => {
  const [locationAvailable, setLocationAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    AppContainer.getInstance().emergencyLocationRepository.getSummary(event.eventId).then(summary => {
      if (mounted) {
        setLocationAvailable(summary?.status === EmergencyLocationStatus.AVAILABLE || summary?.status === EmergencyLocationStatus.STALE);
      }
    });
    return () => { mounted = false; };
  }, [event.eventId]);

  const isActive = isOpenEmergencyState(event.state);
  const isSynced = event.syncStatus === SyncStatus.SYNCED;

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.cardPressed]} onPress={onPress} testID={`history-card-${event.eventId}`}>
      <View style={styles.cardHeader}>
        <View style={styles.headerLeft}>
          <Text style={styles.cardTitle}>Emergency</Text>
          <Text style={styles.cardSource} testID={`history-source-${event.eventId}`}>{formatTriggerSource(event.triggerSource)}</Text>
        </View>
        <Text style={styles.cardDate}>{formatDate(event.createdAt)}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.statusRow}>
        <View style={styles.statusCol}>
          <Text style={styles.statusLabel}>Status</Text>
          <View style={styles.statusValRow}>
            {isActive ? (
              <>
                <View style={styles.activeDot} />
                <Text style={styles.valActive} testID={`history-state-${event.eventId}`}>Active</Text>
              </>
            ) : (
              <>
                <Icon name="check-circle" size={16} color={colors.success} />
                <Text style={styles.valResolved} testID={`history-state-${event.eventId}`}>{formatEmergencyState(event.state)}</Text>
              </>
            )}
          </View>
        </View>

        <View style={styles.statusCol}>
          <Text style={styles.statusLabel}>Location</Text>
          <Text style={styles.valNormal} testID={`history-location-${event.eventId}`}>
            {locationAvailable === true ? 'Available' : locationAvailable === false ? 'Unavailable' : 'Checking...'}
          </Text>
        </View>

        <View style={styles.statusCol}>
          <Text style={styles.statusLabel}>Server</Text>
          <View style={styles.statusValRow}>
            {isSynced ? <Icon name="check" size={16} color={colors.textSecondary} /> : null}
            <Text style={styles.valNormal} testID={`history-sync-${event.eventId}`}>{isSynced ? 'Synced' : 'Local / Pending'}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
};

export const HistoryScreen: React.FC<MainTabScreenProps<'History'>> = ({ navigation }) => {
  const allEvents = useEmergencyStore((s) => s.allEvents);

  const sortedEvents = [...allEvents].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
      </View>

      {sortedEvents.length === 0 ? (
        <View style={styles.emptyContainer} testID="history-empty">
          <Icon name="history" size={48} color={colors.border} />
          <Text style={styles.emptyTitle}>No emergency incidents yet</Text>
          <Text style={styles.emptyBody}>Your emergency history will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={sortedEvents}
          keyExtractor={(item) => item.eventId}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <HistoryCard
              event={item}
              onPress={() => navigation.navigate('IncidentDetails', { eventId: item.eventId })}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { padding: spacing.screenHorizontal, paddingBottom: 12 },
  title: { ...typography.screenTitle, color: colors.textPrimary },
  list: { paddingHorizontal: spacing.screenHorizontal, paddingBottom: 40, gap: 16 },
  
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.textPrimary, marginTop: 16 },
  emptyBody: { fontSize: 14, color: colors.textSecondary, marginTop: 8, textAlign: 'center' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    ...cardShadow,
  },
  cardPressed: { opacity: 0.8 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headerLeft: { flex: 1 },
  cardTitle: { fontSize: 13, color: colors.textSecondary },
  cardSource: { fontSize: 15, color: colors.textPrimary, fontWeight: '700', marginTop: 2 },
  cardDate: { fontSize: 13, color: colors.textSecondary },
  
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  
  statusRow: { flexDirection: 'row', justifyContent: 'space-between' },
  statusCol: { flex: 1, gap: 4 },
  statusLabel: { fontSize: 12, color: colors.textMuted },
  statusValRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.emergencyRed },
  valActive: { fontSize: 13, color: colors.emergencyRed, fontWeight: '700' },
  valResolved: { fontSize: 13, color: colors.success, fontWeight: '600' },
  valNormal: { fontSize: 13, color: colors.textPrimary, fontWeight: '500' },
});
