import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useContactsStore } from '../../contacts/store/contactsStore';
import {
  MAX_PRIORITY,
  MIN_PRIORITY,
  activationBlockedReason,
  formatIndianMobile,
  normalizeIndianMobile,
  validateContactInput,
} from '../../contacts/domain/TrustedContact';
import { RootStackScreenProps } from '../../navigation/types';
import { colors, radii, spacing, typography } from '../../design/tokens';
import { Icon } from '../../design/Icon';

/** Add or edit a trusted contact. The server validates everything again and is authoritative. */
export const ContactFormScreen: React.FC<RootStackScreenProps<'ContactForm'>> = ({ navigation, route }) => {
  const contacts = useContactsStore((s) => s.contacts);
  const createContact = useContactsStore((s) => s.create);
  const updateContact = useContactsStore((s) => s.update);
  const removeContact = useContactsStore((s) => s.remove);

  const editing = route.params?.contactId ? contacts.find((c) => c.id === route.params.contactId) ?? null : null;
  const isEdit = !!editing;

  const [name, setName] = useState(editing?.name ?? '');
  const [phone, setPhone] = useState(editing ? editing.phone : '');
  const [relationship, setRelationship] = useState(editing?.relationship ?? '');
  const [priority, setPriority] = useState(editing?.priority ?? Math.min(contacts.length + 1, MAX_PRIORITY));
  const activationBlocked = activationBlockedReason(contacts, editing?.id ?? null);
  const [isActive, setIsActive] = useState(editing ? editing.isActive : !activationBlocked);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const input = { name, phone, relationship: relationship.trim() || null, priority, isActive };
  const { errors } = useMemo(
    () => validateContactInput(input, contacts, editing?.id ?? null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [name, phone, relationship, priority, isActive, contacts, editing?.id]
  );
  const normalizedPreview = normalizeIndianMobile(phone);

  const onSave = async () => {
    setShowErrors(true);
    setSubmitError(null);
    if (Object.keys(errors).length > 0) return;
    setBusy(true);
    const res = editing ? await updateContact(editing.id, input) : await createContact(input);
    setBusy(false);
    if (res.ok) navigation.goBack();
    else setSubmitError(res.message);
  };

  const onToggleActive = (value: boolean) => {
    if (value && activationBlocked && !(editing && editing.isActive)) {
      Alert.alert('Can’t activate contact', activationBlocked);
      return;
    }
    setIsActive(value);
  };

  const onRemove = () => {
    if (!editing) return;
    Alert.alert(
      `Remove ${editing.name}?`,
      'Removed contacts will not be alerted again. Past alert history is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            const res = await removeContact(editing.id);
            setBusy(false);
            if (res.ok) navigation.goBack();
            else setSubmitError(res.message);
          },
        },
      ]
    );
  };

  if (route.params?.contactId && !editing) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']}>
        <Text style={[styles.error, styles.pad]}>This contact is no longer available.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']} testID={isEdit ? 'contact-form-edit' : 'contact-form-add'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{isEdit ? 'Edit contact' : 'Add trusted contact'}</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Mom"
          placeholderTextColor={colors.textMuted}
          maxLength={100}
          editable={!busy}
          testID="contact-name"
        />
        {showErrors && errors.name && <Text style={styles.error}>{errors.name}</Text>}

        <Text style={styles.label}>Mobile number (India)</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="98765 43210"
          placeholderTextColor={colors.textMuted}
          keyboardType="phone-pad"
          editable={!busy}
          testID="contact-phone"
        />
        {normalizedPreview && (
          <Text style={styles.hint} testID="contact-phone-normalized">
            Saved as {formatIndianMobile(normalizedPreview)}
          </Text>
        )}
        {showErrors && errors.phone && <Text style={styles.error}>{errors.phone}</Text>}

        <Text style={styles.label}>Relationship (optional)</Text>
        <TextInput
          style={styles.input}
          value={relationship}
          onChangeText={setRelationship}
          placeholder="e.g. Mother"
          placeholderTextColor={colors.textMuted}
          maxLength={50}
          editable={!busy}
          testID="contact-relationship"
        />

        <Text style={styles.label}>Priority (1 = alerted first)</Text>
        <View style={styles.stepper}>
          <Pressable
            style={styles.stepButton}
            onPress={() => setPriority((p) => Math.max(MIN_PRIORITY, p - 1))}
            disabled={busy || priority <= MIN_PRIORITY}
            accessibilityLabel="Higher priority"
            testID="contact-priority-down"
          >
            <Icon name="remove" size={22} color={colors.primaryNavy} />
          </Pressable>
          <Text style={styles.stepValue} testID="contact-priority">
            {priority}
          </Text>
          <Pressable
            style={styles.stepButton}
            onPress={() => setPriority((p) => Math.min(MAX_PRIORITY, p + 1))}
            disabled={busy || priority >= MAX_PRIORITY}
            accessibilityLabel="Lower priority"
            testID="contact-priority-up"
          >
            <Icon name="add" size={22} color={colors.primaryNavy} />
          </Pressable>
        </View>

        <View style={styles.activeRow}>
          <View style={styles.activeText}>
            <Text style={styles.activeTitle}>Active</Text>
            <Text style={styles.hint}>
              {isActive ? 'Will be alerted in an emergency.' : 'Kept in your list but will not be alerted.'}
            </Text>
          </View>
          <Switch
            value={isActive}
            onValueChange={onToggleActive}
            disabled={busy}
            trackColor={{ false: colors.switchTrackOff, true: colors.success }}
            thumbColor={colors.white}
            testID="contact-active"
          />
        </View>
        {activationBlocked && !isActive && !(editing && editing.isActive) && (
          <Text style={styles.hint} testID="contact-activation-blocked">
            {activationBlocked}
          </Text>
        )}

        {submitError && (
          <Text style={styles.error} testID="contact-submit-error">
            {submitError}
          </Text>
        )}

        <Pressable
          style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
          onPress={onSave}
          disabled={busy}
          accessibilityRole="button"
          testID="contact-save"
        >
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>{isEdit ? 'Save' : 'Add contact'}</Text>}
        </Pressable>

        {isEdit && (
          <Pressable style={styles.remove} onPress={onRemove} disabled={busy} testID="contact-remove">
            <Icon name="delete-outline" size={20} color={colors.emergencyRedDark} />
            <Text style={styles.removeText}>Remove contact</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  pad: { padding: spacing.screenHorizontal },
  content: { padding: spacing.screenHorizontal, paddingBottom: 32 },
  title: { ...typography.screenTitle, color: colors.textPrimary, marginBottom: 8 },
  label: { ...typography.caption, fontWeight: '600', color: colors.textPrimary, marginTop: 14, marginBottom: 6 },
  input: {
    height: 50,
    borderRadius: radii.tile,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  hint: { ...typography.caption, color: colors.textSecondary, marginTop: 6 },
  error: { ...typography.body, color: colors.emergencyRedDark, marginTop: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  stepButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { ...typography.cardTitle, color: colors.textPrimary, minWidth: 32, textAlign: 'center' },
  activeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20 },
  activeText: { flex: 1, marginRight: 12 },
  activeTitle: { ...typography.cardTitle, color: colors.textPrimary },
  primary: {
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.emergencyRed,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  pressed: { opacity: 0.8 },
  primaryText: { ...typography.button, color: colors.white },
  remove: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: 20, padding: 10 },
  removeText: { ...typography.body, fontWeight: '700', color: colors.emergencyRedDark },
});
