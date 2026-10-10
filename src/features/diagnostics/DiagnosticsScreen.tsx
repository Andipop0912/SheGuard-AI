import React, { useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useActivationStore } from '../../activation/store/activationStore';
import { useEmergencyStore } from '../../emergency/store/emergencyStore';
import { useVoiceStore } from '../../voice/store/voiceStore';
import { ActivationState } from '../../activation/domain/ActivationState';
import { EmergencyTriggerSource } from '../../emergency/domain/EmergencyTriggerSource';
import { AppContainer } from '../../app/di/AppContainer';
import { useAuthStore } from '../../auth/store/authStore';
import { useSyncStore } from '../../sync/syncStore';
import { getEventOwner } from '../../app/identity';
import { LocationDiagnosticsCard } from '../../location/dev/LocationDiagnosticsCard';

/**
 * Developer diagnostics (the pre-Phase-3 screen, preserved unchanged in behaviour).
 * Registered only in __DEV__ builds; reachable from the Settings tab.
 */
export const DiagnosticsScreen: React.FC = () => {
  const {
    activationState,
    activeSessionId,
    lastResult,
    stopProtection,
    resetToInactive,
  } = useActivationStore();

  const {
    currentEvent,
    triggerEmergency,
    resolveEmergency,
    cancelEmergency,
    syncNow,
    loadAllEvents,
  } = useEmergencyStore();

  const {
    voiceState,
    isListening: isVoiceListening,
    lastPayload: lastVoicePayload,
    stopVoiceListening,
    simulateVoiceKeyword,
  } = useVoiceStore();

  const authState = useAuthStore((s) => s.authState);
  const session = useAuthStore((s) => s.session);
  const syncActivity = useSyncStore((s) => s.activity);

  // The safety core is started once by the app bootstrap (src/app/bootstrap.ts); this
  // developer screen only refreshes the stored event list it displays.
  useEffect(() => {
    loadAllEvents();
  }, []);

  const handleSimulateActivation = () => {
    const container = AppContainer.getInstance();
    container.mockActivationSource.simulateActivation(true);
  };

  const handleTriggerEmergency = async () => {
    const owner = getEventOwner();
    await triggerEmergency(owner.userId, owner.deviceId, EmergencyTriggerSource.MANUAL_SOS);
  };

  const handleResolveEmergency = async () => {
    if (currentEvent) {
      await resolveEmergency(currentEvent.eventId);
    }
  };

  const handleCancelEmergency = async () => {
    if (currentEvent) {
      await cancelEmergency(currentEvent.eventId);
    }
  };

  const isProtectionActive = activationState === ActivationState.ACTIVE;

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>SheGuard AI</Text>
          <Text style={styles.headerSubtitle}>Personal Safety & Emergency Response</Text>
        </View>

        {/* Status Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>System Status</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Protection State:</Text>
            <Text
              style={[
                styles.valueBold,
                isProtectionActive ? styles.activeText : styles.inactiveText,
              ]}
            >
              {activationState}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Session ID:</Text>
            <Text style={styles.valueMono} numberOfLines={1}>
              {activeSessionId ?? 'None'}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Server Sync:</Text>
            <Text style={[styles.valueBold, syncActivity.kind === 'IDLE' ? styles.onlineText : styles.offlineText]}>
              {syncActivity.kind}
            </Text>
          </View>
        </View>

        {/* Emergency Status Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Emergency State</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Active Event ID:</Text>
            <Text style={styles.valueMono} numberOfLines={1}>
              {currentEvent?.eventId ?? 'None'}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Emergency State:</Text>
            <Text style={styles.valueBold}>
              {currentEvent?.state ?? 'IDLE'}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Trigger Source:</Text>
            <Text style={styles.value}>
              {currentEvent?.triggerSource ?? 'None'}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Sync Status:</Text>
            <Text style={styles.valueBold}>
              {currentEvent?.syncStatus ?? 'N/A'}
            </Text>
          </View>

          {lastResult && (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>Last Activation Result:</Text>
              <Text style={styles.resultText}>{JSON.stringify(lastResult)}</Text>
            </View>
          )}
        </View>

        <LocationDiagnosticsCard />

        {/* Voice V1 Protection Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Voice V1 Protection (Vosk Local)</Text>

          <View style={styles.row}>
            <Text style={styles.label}>Voice Detector State:</Text>
            <Text style={[styles.valueBold, isVoiceListening ? styles.activeText : styles.inactiveText]}>
              {voiceState}
            </Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>Emergency Hotword:</Text>
            <Text style={styles.valueBold}>"SheGuard Emergency"</Text>
          </View>

          <View style={styles.row}>
            <Text style={styles.label}>ARM Dependent:</Text>
            <Text style={styles.valueBold}>NO (Independent)</Text>
          </View>

          {lastVoicePayload && (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>Last Voice Trigger Payload:</Text>
              <Text style={styles.resultText}>{JSON.stringify(lastVoicePayload)}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, styles.primaryButton, { marginTop: 10, marginBottom: 0 }]}
            onPress={simulateVoiceKeyword}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Simulate "SheGuard Emergency" Hotword</Text>
          </TouchableOpacity>
        </View>

        {/* Controls */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.primaryButton]}
            onPress={handleSimulateActivation}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Simulate Activation</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.dangerButton]}
            onPress={handleTriggerEmergency}
            activeOpacity={0.8}
          >
            <Text style={styles.dangerButtonText}>Trigger Manual SOS</Text>
          </TouchableOpacity>

          {isProtectionActive ? (
            <TouchableOpacity
              style={[styles.button, styles.warningButton]}
              onPress={stopProtection}
              activeOpacity={0.8}
            >
              <Text style={styles.warningButtonText}>Stop Protection</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={resetToInactive}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryButtonText}>Reset to Inactive</Text>
            </TouchableOpacity>
          )}

          {currentEvent && currentEvent.state !== 'RESOLVED' && currentEvent.state !== 'CANCELLED' && (
            <View style={styles.rowButtons}>
              <TouchableOpacity
                style={[styles.halfButton, styles.successButton]}
                onPress={handleResolveEmergency}
              >
                <Text style={styles.successButtonText}>Resolve</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.halfButton, styles.cancelButton]}
                onPress={handleCancelEmergency}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.outlineButtonText} testID="diag-server-state">
            Account: {authState}
            {session ? ` (${session.phone})` : ''} · Sync: {syncActivity.kind}
            {currentEvent ? ` · Event sync: ${currentEvent.syncStatus}` : ''}
          </Text>

          <TouchableOpacity
            style={[styles.button, styles.outlineButton]}
            onPress={() => {
              syncNow().catch(() => undefined);
            }}
          >
            <Text style={styles.outlineButtonText}>Sync Now</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  container: {
    padding: 20,
  },
  header: {
    marginBottom: 20,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f8fafc',
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#38bdf8',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    color: '#cbd5e1',
  },
  value: {
    fontSize: 14,
    color: '#f8fafc',
  },
  valueBold: {
    fontSize: 14,
    fontWeight: '700',
    color: '#f8fafc',
  },
  valueMono: {
    fontSize: 13,
    fontFamily: 'monospace',
    color: '#e2e8f0',
    maxWidth: '55%',
  },
  activeText: {
    color: '#4ade80',
  },
  inactiveText: {
    color: '#94a3b8',
  },
  onlineText: {
    color: '#34d399',
  },
  offlineText: {
    color: '#f87171',
  },
  resultBox: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#0f172a',
    borderRadius: 6,
  },
  resultLabel: {
    fontSize: 12,
    color: '#94a3b8',
  },
  resultText: {
    fontSize: 12,
    color: '#e2e8f0',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  buttonContainer: {
    marginTop: 8,
  },
  button: {
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButton: {
    backgroundColor: '#0284c7',
  },
  primaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  dangerButton: {
    backgroundColor: '#dc2626',
  },
  dangerButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
  },
  warningButton: {
    backgroundColor: '#ea580c',
  },
  warningButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: '#475569',
  },
  secondaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 16,
  },
  rowButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  halfButton: {
    flex: 0.48,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  successButton: {
    backgroundColor: '#16a34a',
  },
  successButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 15,
  },
  cancelButton: {
    backgroundColor: '#64748b',
  },
  cancelButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 15,
  },
  outlineButton: {
    borderWidth: 1,
    borderColor: '#475569',
    backgroundColor: 'transparent',
  },
  outlineButtonText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
  },
});
