import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useLocationStore } from '../store/locationStore';
import { fixAgeMs, LocationFix } from '../domain/LocationFix';
import { LocationAvailability } from '../domain/LocationState';

/**
 * Developer card for physical validation of the location foundation (not the product UI).
 * Shows only real states; coordinates are authoritative, the address is best-effort.
 */
function describeFix(fix: LocationFix | null, now: number): string {
  if (!fix) return 'None';
  const ageSec = Math.round(fixAgeMs(fix, now) / 1000);
  const accuracy = fix.accuracyMeters !== null ? ` ±${Math.round(fix.accuracyMeters)}m` : '';
  return `${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}${accuracy} · ${ageSec}s ago · ${fix.provider}${
    fix.isLastKnown ? ' (last known)' : ''
  }`;
}

const AVAILABILITY_LABEL: Record<LocationAvailability, string> = {
  [LocationAvailability.UNAVAILABLE]: 'Unavailable',
  [LocationAvailability.PERMISSION_REQUIRED]: 'Permission required',
  [LocationAvailability.PERMISSION_DENIED]: 'Permission denied',
  [LocationAvailability.ACQUIRING]: 'Getting location…',
  [LocationAvailability.AVAILABLE]: 'Location available',
  [LocationAvailability.STALE]: 'Last known location',
  [LocationAvailability.ERROR]: 'Error',
};

export const LocationDiagnosticsCard: React.FC = () => {
  const readiness = useLocationStore((s) => s.readiness);
  const emergencyLocation = useLocationStore((s) => s.emergencyLocation);
  const tracking = useLocationStore((s) => s.tracking);
  const sync = useLocationStore((s) => s.sync);
  const address = useLocationStore((s) => s.address);
  const addressFor = useLocationStore((s) => s.addressFor);
  const requestPermission = useLocationStore((s) => s.requestPermission);
  const refreshCurrentLocation = useLocationStore((s) => s.refreshCurrentLocation);
  const lookupAddress = useLocationStore((s) => s.lookupAddress);

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const shownFix = emergencyLocation?.latestFix ?? readiness.fix;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Location (Phase 2 diagnostics)</Text>

      <Row label="Location" value={AVAILABILITY_LABEL[readiness.availability]} />
      <Row label="Permission" value={readiness.permission} />
      <Row label="Location services" value={readiness.servicesEnabled ? 'ON' : 'OFF'} />
      {readiness.reason && <Row label="Reason" value={readiness.reason} />}
      <Row label="Device fix" value={describeFix(readiness.fix, now)} />
      <Row label="Address" value={address && addressFor === shownFix ? address : 'Not resolved'} />

      <View style={styles.divider} />
      <Row label="Tracking" value={tracking} />
      <Row label="Emergency location" value={emergencyLocation ? emergencyLocation.status : 'No emergency'} />
      {emergencyLocation && (
        <>
          <Row label="Event" value={emergencyLocation.eventId.slice(0, 16)} />
          {emergencyLocation.reason && <Row label="Why" value={emergencyLocation.reason} />}
          {emergencyLocation.trackingFailureReason && (
            <Row label="Tracking failure" value={emergencyLocation.trackingFailureReason} />
          )}
          <Row label="Points stored" value={String(emergencyLocation.pointCount)} />
          <Row label="Latest point" value={describeFix(emergencyLocation.latestFix, now)} />
        </>
      )}
      <Row label="Server sync" value={`${sync.kind} · ${sync.pending} pending`} />

      <View style={styles.buttons}>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Request permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={refreshCurrentLocation}>
          <Text style={styles.buttonText}>Get current location</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, !shownFix && styles.disabled]}
          disabled={!shownFix}
          onPress={() => shownFix && lookupAddress(shownFix)}
        >
          <Text style={styles.buttonText}>Look up address</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardTitle: { fontSize: 18, fontWeight: '600', color: '#38bdf8', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, gap: 8 },
  label: { fontSize: 13, color: '#cbd5e1' },
  value: { fontSize: 13, color: '#f8fafc', fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: '#334155', marginVertical: 8 },
  buttons: { marginTop: 8, gap: 8 },
  button: { backgroundColor: '#0284c7', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
  disabled: { opacity: 0.5 },
});
