import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, typography } from '../tokens';
import { Icon, IconName } from '../Icon';

/** Siren halo + title (emergency_header.dart: 104/84/64 circles). */
export const EmergencyHeader: React.FC<{ title: string; subtitle: string }> = ({ title, subtitle }) => (
  <View style={styles.headerColumn}>
    <View style={[styles.halo, { width: 104, height: 104, borderRadius: 52, backgroundColor: 'rgba(236,28,62,0.15)' }]}>
      <View style={[styles.halo, { width: 84, height: 84, borderRadius: 42, backgroundColor: 'rgba(236,28,62,0.30)' }]}>
        <View style={[styles.halo, styles.haloCore]}>
          <Icon name="notifications-active" size={32} color={colors.white} />
        </View>
      </View>
    </View>
    <Text style={styles.headerTitle}>{title}</Text>
    <Text style={styles.headerSubtitle}>{subtitle}</Text>
  </View>
);

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${String(h).padStart(2, '0')}:${m}:${s}` : `${m}:${s}`;
}

function formatClock(timestamp: number): string {
  const d = new Date(timestamp);
  const hours = d.getHours();
  return `${hours % 12 === 0 ? 12 : hours % 12}:${String(d.getMinutes()).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
}

/**
 * Elapsed timer (emergency_timer.dart). Counts from the EmergencyEvent's createdAt — not from
 * when the screen opened — so it stays correct across navigation and app restarts.
 */
export const EmergencyTimer: React.FC<{ startedAt: number; now?: () => number }> = ({ startedAt, now = Date.now }) => {
  const [current, setCurrent] = useState(now());
  useEffect(() => {
    const id = setInterval(() => setCurrent(now()), 1000);
    return () => clearInterval(id);
  }, [now]);
  return (
    <View style={styles.timerColumn}>
      <Text style={styles.timer} testID="emergency-timer">
        {formatElapsed(current - startedAt)}
      </Text>
      <Text style={styles.timerSince}>Since {formatClock(startedAt)}</Text>
    </View>
  );
};

export type BadgeTone = 'active' | 'pending' | 'neutral';

const BADGE: Record<BadgeTone, { bg: string; fg: string }> = {
  active: { bg: colors.badgeActiveBg, fg: colors.badgeActiveText },
  pending: { bg: colors.badgePendingBg, fg: colors.badgePendingText },
  neutral: { bg: colors.badgeNeutralBg, fg: colors.badgeNeutralText },
};

/** Status card (emergency_status_card.dart). */
export const EmergencyStatusCard: React.FC<{
  icon: IconName;
  iconBackground: string;
  title: string;
  status: string;
  badge?: { text: string; tone: BadgeTone };
  testID?: string;
}> = ({ icon, iconBackground, title, status, badge, testID }) => (
  <View style={styles.card} testID={testID}>
    <View style={[styles.cardIcon, { backgroundColor: iconBackground }]}>
      <Icon name={icon} size={20} color={colors.white} />
    </View>
    <View style={styles.cardText}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardStatus}>{status}</Text>
    </View>
    {badge && (
      <View style={[styles.badge, { backgroundColor: BADGE[badge.tone].bg }]}>
        <Text style={[styles.badgeText, { color: BADGE[badge.tone].fg }]}>{badge.text}</Text>
      </View>
    )}
  </View>
);

/** Full-width "Resolve Alert" with confirmation (resolve_alert_button.dart). */
export const ResolveAlertButton: React.FC<{ onResolve: () => void; disabled?: boolean }> = ({ onResolve, disabled }) => {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Pressable
        testID="emergency-resolve"
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setConfirming(true)}
        style={({ pressed }) => [styles.resolve, (pressed || disabled) && styles.resolvePressed]}
      >
        <Icon name="close" size={20} color={colors.white} />
        <Text style={styles.resolveText}>Resolve Alert</Text>
      </Pressable>
      <Modal transparent visible={confirming} animationType="fade" onRequestClose={() => setConfirming(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Resolve Alert</Text>
            <Text style={styles.dialogBody}>Resolve this emergency alert?</Text>
            <View style={styles.dialogActions}>
              <Pressable onPress={() => setConfirming(false)} testID="emergency-resolve-cancel" hitSlop={8}>
                <Text style={styles.dialogCancel}>Cancel</Text>
              </Pressable>
              <Pressable
                testID="emergency-resolve-confirm"
                hitSlop={8}
                onPress={() => {
                  setConfirming(false);
                  onResolve();
                }}
              >
                <Text style={styles.dialogConfirm}>Resolve</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  headerColumn: { alignItems: 'center' },
  halo: { alignItems: 'center', justifyContent: 'center' },
  haloCore: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.emergencyRed,
    shadowColor: colors.emergencyRed,
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  headerTitle: { color: colors.white, fontSize: 18, fontWeight: '800', letterSpacing: 1, marginTop: 12 },
  headerSubtitle: { color: colors.emergencySubtitle, fontSize: 13, marginTop: 4, textAlign: 'center' },
  timerColumn: { alignItems: 'center' },
  timer: { ...typography.timer, color: colors.textOnDark },
  timerSince: { color: colors.textOnDarkMuted, fontSize: 13, fontWeight: '500', marginTop: 2 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.emergencyCard,
    borderRadius: radii.emergencyCard,
    borderWidth: 1,
    borderColor: colors.emergencyCardBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  cardIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, marginLeft: 12, marginRight: 8 },
  cardTitle: { color: colors.white, fontSize: 14, fontWeight: '600' },
  cardStatus: { color: colors.textOnDarkSecondary, fontSize: 12, marginTop: 2 },
  badge: { borderRadius: radii.badge, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  resolve: {
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.emergencyRed,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  resolvePressed: { opacity: 0.85 },
  resolveText: { color: colors.white, fontSize: 16, fontWeight: '700', letterSpacing: 0.3, marginLeft: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 32 },
  dialog: {
    backgroundColor: '#1F0E14',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.emergencyCardBorder,
    padding: 24,
  },
  dialogTitle: { color: colors.textOnDark, fontSize: 18, fontWeight: '700' },
  dialogBody: { color: colors.textOnDarkSecondary, fontSize: 15, marginTop: 12 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 24, gap: 24 },
  dialogCancel: { color: colors.textOnDarkMuted, fontWeight: '600', fontSize: 15 },
  dialogConfirm: { color: colors.emergencyRed, fontWeight: '700', fontSize: 15 },
});
