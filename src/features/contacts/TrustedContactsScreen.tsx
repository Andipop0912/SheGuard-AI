import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useContactsStore } from '../../contacts/store/contactsStore';
import { useAuthStore } from '../../auth/store/authStore';
import {
  MAX_ACTIVE_TRUSTED_CONTACTS,
  MAX_TRUSTED_CONTACTS,
  TrustedContact,
  activeCount,
  addBlockedReason,
  formatIndianMobile,
} from '../../contacts/domain/TrustedContact';
import { RootStackScreenProps } from '../../navigation/types';
import { colors, radii, spacing, typography } from '../../design/tokens';
import { Icon } from '../../design/Icon';

/**
 * Trusted Contacts list. Contacts live on the server (it chooses who is alerted: ACTIVE only,
 * in priority order). Nothing here is on the emergency path.
 */
export const TrustedContactsScreen: React.FC<RootStackScreenProps<'TrustedContacts'>> = ({ navigation }) => {
  const session = useAuthStore((s) => s.session);
  const contacts = useContactsStore((s) => s.contacts);
  const loadState = useContactsStore((s) => s.loadState);
  const error = useContactsStore((s) => s.error);
  const load = useContactsStore((s) => s.load);
  const setActive = useContactsStore((s) => s.setActive);
  const [busyId, setBusyId] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (session) load();
    }, [session, load])
  );

  const total = contacts.length;
  const active = activeCount(contacts);
  const addBlocked = addBlockedReason(contacts);

  const onToggle = async (contact: TrustedContact, value: boolean) => {
    setBusyId(contact.id);
    const res = await setActive(contact.id, value);
    setBusyId(null);
    if (!res.ok) Alert.alert(value ? 'Can’t activate contact' : 'Can’t deactivate contact', res.message);
  };

  const onAdd = () => {
    if (addBlocked) {
      Alert.alert('Contact limit reached', addBlocked);
      return;
    }
    navigation.navigate('ContactForm', {});
  };

  if (!session) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']} testID="contacts-signed-out">
        <View style={styles.center}>
          <Icon name="people-alt" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Sign in to manage trusted contacts</Text>
          <Text style={styles.emptyBody}>
            Trusted contacts are kept on the SheGuard server, which alerts them when you trigger an emergency.
          </Text>
          <Pressable style={styles.primary} onPress={() => navigation.navigate('SignIn')} testID="contacts-sign-in">
            <Text style={styles.primaryText}>Sign in</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']} testID="contacts-screen">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Trusted Contacts</Text>
        <Text style={styles.subtitle}>
          Only active contacts are alerted in an emergency, in priority order. Up to {MAX_TRUSTED_CONTACTS} contacts,{' '}
          {MAX_ACTIVE_TRUSTED_CONTACTS} active.
        </Text>
        <Text style={styles.counts} testID="contacts-counts">
          {total} of {MAX_TRUSTED_CONTACTS} contacts · {active} of {MAX_ACTIVE_TRUSTED_CONTACTS} active
        </Text>

        {loadState === 'loading' && contacts.length === 0 && (
          <ActivityIndicator style={styles.loading} color={colors.primaryNavy} testID="contacts-loading" />
        )}

        {loadState === 'error' && (
          <View style={styles.errorBox} testID="contacts-error">
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={load} testID="contacts-retry">
              <Text style={styles.link}>Try again</Text>
            </Pressable>
          </View>
        )}

        {loadState === 'ready' && contacts.length === 0 && (
          <View style={styles.emptyCard} testID="contacts-empty">
            <Icon name="people-alt" size={32} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No trusted contacts yet</Text>
            <Text style={styles.emptyBody}>Add the people who should be alerted when you trigger an emergency.</Text>
          </View>
        )}

        {contacts.map((contact) => (
          <Pressable
            key={contact.id}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => navigation.navigate('ContactForm', { contactId: contact.id })}
            testID={`contact-row-${contact.phone}`}
            accessibilityRole="button"
          >
            <View style={styles.rowText}>
              <Text style={styles.rowName}>
                {contact.name}
                {contact.relationship ? <Text style={styles.rowRelation}>  · {contact.relationship}</Text> : null}
              </Text>
              <Text style={styles.rowPhone}>{formatIndianMobile(contact.phone)}</Text>
              <Text style={styles.rowMeta}>
                Priority {contact.priority} · {contact.isActive ? 'Active' : 'Inactive — will not be alerted'}
              </Text>
            </View>
            <Switch
              value={contact.isActive}
              onValueChange={(v) => onToggle(contact, v)}
              disabled={busyId === contact.id}
              trackColor={{ false: colors.switchTrackOff, true: colors.success }}
              thumbColor={colors.white}
              accessibilityLabel={`${contact.name} active`}
              testID={`contact-active-${contact.phone}`}
            />
          </Pressable>
        ))}

        <Pressable
          style={({ pressed }) => [styles.primary, styles.addButton, (pressed || !!addBlocked) && styles.pressed]}
          onPress={onAdd}
          accessibilityRole="button"
          testID="contacts-add"
        >
          <Icon name="person-add" size={20} color={colors.white} />
          <Text style={styles.primaryText}>Add contact</Text>
        </Pressable>
        {addBlocked && <Text style={styles.limitNote}>{addBlocked}</Text>}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.screenHorizontal, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screenHorizontal },
  title: { ...typography.screenTitle, color: colors.textPrimary },
  subtitle: { ...typography.cardSubtitle, color: colors.textSecondary, marginTop: 6, lineHeight: 18 },
  counts: { ...typography.caption, fontWeight: '600', color: colors.primaryNavy, marginTop: 10, marginBottom: 12 },
  loading: { marginTop: 24 },
  errorBox: { backgroundColor: colors.emergencyRedLight, borderRadius: radii.tile, padding: 14, marginBottom: 12 },
  errorText: { ...typography.body, color: colors.emergencyRedDark },
  link: { ...typography.body, fontWeight: '700', color: colors.primaryNavy, marginTop: 8 },
  emptyCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 24,
    marginBottom: 12,
  },
  emptyTitle: { ...typography.cardTitle, color: colors.textPrimary, marginTop: 10, textAlign: 'center' },
  emptyBody: { ...typography.cardSubtitle, color: colors.textSecondary, marginTop: 6, textAlign: 'center', lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 10,
  },
  pressed: { opacity: 0.8 },
  rowText: { flex: 1, marginRight: 12 },
  rowName: { ...typography.cardTitle, color: colors.textPrimary },
  rowRelation: { ...typography.cardSubtitle, color: colors.textSecondary },
  rowPhone: { ...typography.body, color: colors.textPrimary, marginTop: 4 },
  rowMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  primary: {
    flexDirection: 'row',
    gap: 8,
    height: 50,
    borderRadius: radii.pill,
    backgroundColor: colors.emergencyRed,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginTop: 16,
  },
  addButton: { marginTop: 8 },
  primaryText: { ...typography.button, color: colors.white },
  limitNote: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: 8 },
});
