import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from '../../auth/store/authStore';
import { AuthState } from '../../auth/domain/AuthState';
import { useSyncStore } from '../../sync/syncStore';
import { colors, radii, typography } from '../../design/tokens';
import { Icon } from '../../design/Icon';

/**
 * Account entry on the Settings tab (the Settings screen itself is Phase 3L).
 * Shows who is signed in and the truthful backup state; sign-out keeps local emergencies.
 */
export const AccountCard: React.FC<{ onSignIn: () => void; onRegister: () => void }> = ({ onSignIn, onRegister }) => {
  const authState = useAuthStore((s) => s.authState);
  const session = useAuthStore((s) => s.session);
  const endedReason = useAuthStore((s) => s.endedReason);
  const logout = useAuthStore((s) => s.logout);
  const activity = useSyncStore((s) => s.activity);
  const [signingOut, setSigningOut] = useState(false);

  const confirmSignOut = () =>
    Alert.alert(
      'Sign out?',
      'Emergencies on this phone are kept. Any not yet backed up will upload after you sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              await logout();
            } finally {
              setSigningOut(false);
            }
          },
        },
      ]
    );

  if (authState === AuthState.UNKNOWN) {
    return (
      <View style={styles.card} testID="account-card">
        <Text style={styles.subtitle}>Checking account…</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.card} testID="account-card">
        <View style={styles.header}>
          <Icon name="cloud-off" size={22} color={colors.textSecondary} />
          <Text style={styles.title}>Not signed in</Text>
        </View>
        <Text style={styles.subtitle}>
          {endedReason ?? 'Emergencies are saved on this phone only. Sign in to back them up to the server.'}
        </Text>
        <View style={styles.row}>
          <Pressable style={[styles.button, styles.primary]} onPress={onSignIn} testID="account-sign-in">
            <Text style={styles.primaryText}>Sign in</Text>
          </Pressable>
          <Pressable style={[styles.button, styles.secondary]} onPress={onRegister} testID="account-register">
            <Text style={styles.secondaryText}>Create account</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const backup =
    activity.kind === 'SYNCING'
      ? 'Backing up…'
      : activity.kind === 'RETRY_SCHEDULED'
      ? `Waiting to back up (${activity.lastError})`
      : activity.kind === 'NOT_CONFIGURED'
      ? 'Server not configured in this build'
      : 'Backup on';

  return (
    <View style={styles.card} testID="account-card">
      <View style={styles.header}>
        <Icon name="verified-user" size={22} color={colors.success} />
        <Text style={styles.title}>Signed in</Text>
      </View>
      <Text style={styles.subtitle} testID="account-phone">
        {session.phone}
      </Text>
      <Text style={styles.subtitle} testID="account-backup">
        {backup}
      </Text>
      <Pressable
        style={[styles.button, styles.secondary, styles.signOut]}
        onPress={confirmSignOut}
        disabled={signingOut}
        testID="account-sign-out"
      >
        <Text style={styles.secondaryText}>{signingOut ? 'Signing out…' : 'Sign out'}</Text>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 18,
    marginBottom: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...typography.cardTitle, color: colors.textPrimary },
  subtitle: { ...typography.cardSubtitle, color: colors.textSecondary, marginTop: 6, lineHeight: 18 },
  row: { flexDirection: 'row', gap: 10, marginTop: 14 },
  button: { flex: 1, height: 44, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  primary: { backgroundColor: colors.emergencyRed },
  primaryText: { ...typography.body, fontWeight: '700', color: colors.white },
  secondary: { backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  secondaryText: { ...typography.body, fontWeight: '700', color: colors.primaryNavy },
  signOut: { flex: 0, marginTop: 14 },
});
