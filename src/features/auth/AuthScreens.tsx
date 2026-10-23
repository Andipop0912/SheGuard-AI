import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../auth/store/authStore';
import { AuthState } from '../../auth/domain/AuthState';
import { RootStackScreenProps } from '../../navigation/types';
import { colors, radii, spacing, typography } from '../../design/tokens';
import { Wordmark } from '../../design/components/Wordmark';

type Mode = 'signIn' | 'register';

const COPY: Record<Mode, { title: string; subtitle: string; submit: string; switchText: string; switchAction: string }> = {
  signIn: {
    title: 'Sign in',
    subtitle: 'Back up your emergencies to the SheGuard server.',
    submit: 'Sign in',
    switchText: 'New to SheGuard?',
    switchAction: 'Create an account',
  },
  register: {
    title: 'Create account',
    subtitle: 'Your mobile number is your SheGuard account.',
    submit: 'Create account',
    switchText: 'Already have an account?',
    switchAction: 'Sign in',
  },
};

/**
 * Sign-in / registration form (Flutter visual language: light background, navy text, red primary
 * action). Signing in only enables server backup; SOS, voice, shake and location never need it.
 */
const AuthForm: React.FC<{ mode: Mode; onDone: () => void; onSwitch: () => void }> = ({ mode, onDone, onSwitch }) => {
  const login = useAuthStore((s) => s.login);
  const register = useAuthStore((s) => s.register);
  const busy = useAuthStore((s) => s.authState === AuthState.AUTHENTICATING);

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[mode];

  const submit = async () => {
    if (busy) return;
    setError(null);
    if (mode === 'register' && password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    const result = mode === 'register' ? await register(phone, password) : await login(phone, password);
    // The password never stays in component state after a request.
    setPassword('');
    setConfirm('');
    if (result.ok) onDone();
    else setError(result.message);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom', 'left', 'right']} testID={`auth-${mode}`}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Wordmark />
          <Text style={styles.tagline}>Smarter Safety</Text>
          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.subtitle}>{copy.subtitle}</Text>

          <Text style={styles.label}>Mobile number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="+91 98765 43210"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            editable={!busy}
            testID="auth-phone"
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={mode === 'register' ? 'password-new' : 'password'}
            editable={!busy}
            testID="auth-password"
          />

          {mode === 'register' && (
            <>
              <Text style={styles.label}>Confirm password</Text>
              <TextInput
                style={styles.input}
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                testID="auth-confirm"
              />
            </>
          )}

          {error && (
            <Text style={styles.error} testID="auth-error" accessibilityLiveRegion="polite">
              {error}
            </Text>
          )}

          <Pressable
            style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]}
            onPress={submit}
            disabled={busy}
            accessibilityRole="button"
            testID="auth-submit"
          >
            {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>{copy.submit}</Text>}
          </Pressable>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>{copy.switchText} </Text>
            <Pressable onPress={onSwitch} disabled={busy} hitSlop={8} testID="auth-switch">
              <Text style={styles.switchAction}>{copy.switchAction}</Text>
            </Pressable>
          </View>

          <Text style={styles.note}>SOS, voice, shake and location protection work without an account.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export const SignInScreen: React.FC<RootStackScreenProps<'SignIn'>> = ({ navigation }) => (
  <AuthForm mode="signIn" onDone={() => navigation.goBack()} onSwitch={() => navigation.replace('Register')} />
);

export const RegisterScreen: React.FC<RootStackScreenProps<'Register'>> = ({ navigation }) => (
  <AuthForm mode="register" onDone={() => navigation.goBack()} onSwitch={() => navigation.replace('SignIn')} />
);

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.screenHorizontal, paddingTop: 16 },
  tagline: { ...typography.caption, color: colors.textMuted, marginTop: 4, letterSpacing: 0.5 },
  title: { ...typography.wordmark, color: colors.textPrimary, marginTop: 28 },
  subtitle: { ...typography.body, color: colors.textSecondary, marginTop: 6, marginBottom: 20 },
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
  error: { ...typography.body, color: colors.emergencyRedDark, marginTop: 14 },
  primary: {
    marginTop: 24,
    height: 52,
    borderRadius: radii.pill,
    backgroundColor: colors.emergencyRed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
  primaryText: { ...typography.button, color: colors.white },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 18 },
  switchText: { ...typography.body, color: colors.textSecondary },
  switchAction: { ...typography.body, fontWeight: '700', color: colors.primaryNavy },
  note: { ...typography.caption, color: colors.textMuted, textAlign: 'center', marginTop: 28 },
});
