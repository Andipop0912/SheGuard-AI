import React, { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useActivationStore } from '../../activation/store/activationStore';
import { ActivationState } from '../../activation/domain/ActivationState';
import { useEmergencyStore } from '../../emergency/store/emergencyStore';
import { isOpenEmergencyState } from '../../emergency/domain/EmergencyState';
import { useVoiceStore } from '../../voice/store/voiceStore';
import { useLocationStore } from '../../location/store/locationStore';
import { MainTabScreenProps } from '../../navigation/types';
import { cardShadow, colors, spacing } from '../../design/tokens';
import { Icon } from '../../design/Icon';
import { Wordmark } from '../../design/components/Wordmark';
import { SosButton, SosButtonState } from '../../design/components/SosButton';
import { ArmedBanner, ProtectionModeCard } from '../../design/components/ProtectionCards';
import { LocationRow, NavCard, StatusList } from '../../design/components/StatusList';
import { sosConfirmationVibration } from '../../design/haptics';
import { presentLocationReadiness, presentProtection, presentShake, presentVoice } from './statusPresentation';

/**
 * Home (Flutter S1 unarmed / S2 armed). Displays and drives the EXISTING core only:
 * ActivationManager (Protection Mode), shake detector, voice service, LocationService and
 * EmergencyCoordinator. It holds no emergency or ARM state of its own.
 */
export const HomeScreen: React.FC<MainTabScreenProps<'Home'>> = ({ navigation }) => {
  const activationState = useActivationStore((s) => s.activationState);
  const isShakeListening = useActivationStore((s) => s.isShakeListening);
  const armedAt = useActivationStore((s) => s.armedAt);
  const arm = useActivationStore((s) => s.arm);
  const disarm = useActivationStore((s) => s.disarm);

  const currentEvent = useEmergencyStore((s) => s.currentEvent);
  const isTriggering = useEmergencyStore((s) => s.isTriggering);
  const triggerManualSos = useEmergencyStore((s) => s.triggerManualSos);

  const voiceState = useVoiceStore((s) => s.voiceState);
  const readiness = useLocationStore((s) => s.readiness);

  const [toggleBusy, setToggleBusy] = useState(false);

  const isArmed = activationState === ActivationState.ACTIVE;
  const hasOpenEmergency = currentEvent !== null && isOpenEmergencyState(currentEvent.state);
  const sosState: SosButtonState = hasOpenEmergency ? 'active' : isTriggering ? 'triggering' : 'idle';

  const onSos = useCallback(() => {
    if (hasOpenEmergency) {
      navigation.navigate('Emergency');
      return;
    }
    // Immediate and local-first: the coordinator records the event; the Emergency screen is
    // presented by the navigation observer as soon as the event exists. Nothing here waits
    // for GPS, network, backend or AI.
    sosConfirmationVibration();
    triggerManualSos().catch((e: unknown) => {
      Alert.alert('SOS could not be recorded', e instanceof Error ? e.message : String(e));
    });
  }, [hasOpenEmergency, navigation, triggerManualSos]);

  const onToggleProtection = useCallback(
    async (on: boolean) => {
      if (toggleBusy) return;
      setToggleBusy(true);
      try {
        if (on) {
          const result = await arm();
          if (result.type !== 'Started' && result.type !== 'Rejected') {
            Alert.alert('Protection Mode', 'Could not turn on Protection Mode.');
          }
        } else {
          await disarm();
        }
      } finally {
        setToggleBusy(false);
      }
    },
    [arm, disarm, toggleBusy]
  );

  const protection = presentProtection(activationState);
  const shake = presentShake(isShakeListening);
  const voice = presentVoice(voiceState);
  const location = presentLocationReadiness(readiness);

  const statusItems = [
    { key: 'protection', icon: 'security' as const, title: 'Protection Mode', ...protection, testID: 'status-protection' },
    { key: 'shake', icon: 'phone-android' as const, title: 'Shake Detection', ...shake, testID: 'status-shake' },
    { key: 'voice', icon: 'mic' as const, title: 'Voice Detection', ...voice, testID: 'status-voice' },
  ];

  const openAsk = () => navigation.navigate('AskSheGuard');
  const openLocation = () => navigation.navigate('LiveLocation');
  const openRouteSafety = () => navigation.navigate('RouteSafety');

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: isArmed ? colors.backgroundDark : colors.background }]}
      edges={['top', 'left', 'right']}
      testID={isArmed ? 'home-armed' : 'home-unarmed'}
    >
      <StatusBar
        barStyle={isArmed ? 'light-content' : 'dark-content'}
        backgroundColor={isArmed ? colors.backgroundDark : colors.background}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Wordmark dark={isArmed} />
          <Pressable
            onPress={() => navigation.navigate('Settings')}
            hitSlop={12}
            accessibilityLabel="Settings"
            testID="home-settings"
          >
            <Icon name="settings" size={24} color={isArmed ? colors.white : colors.primaryNavy} />
          </Pressable>
        </View>

        {isArmed && (
          <View style={styles.gapTop}>
            <ArmedBanner
              value
              onValueChange={onToggleProtection}
              disabled={toggleBusy}
              armedAt={armedAt}
              shakeEnabled={isShakeListening}
              testID="protection-toggle"
            />
          </View>
        )}

        <View style={styles.sos}>
          <SosButton onPress={onSos} dark={isArmed} state={sosState} testID="home-sos" />
        </View>

        {!isArmed && (
          <ProtectionModeCard value={false} onValueChange={onToggleProtection} disabled={toggleBusy} testID="protection-toggle" />
        )}

        <View style={styles.gap}>
          <StatusList items={statusItems} palette={isArmed ? 'armed' : 'light'} />
        </View>

        {isArmed && (
          <Pressable
            style={({ pressed }) => [styles.disarm, pressed && styles.pressed]}
            onPress={() => onToggleProtection(false)}
            disabled={toggleBusy}
            testID="home-disarm"
            accessibilityRole="button"
          >
            <Text style={styles.disarmText}>Disarm</Text>
          </Pressable>
        )}

        <View style={styles.gap}>
          <NavCard
            icon="map"
            title="Route Safety"
            subtitle="Plan a route and open in Google Maps"
            onPress={openRouteSafety}
            testID="home-route-safety"
          />
        </View>
        <View style={styles.gap}>
          <LocationRow label={location.value} tone={location.tone} onPress={openLocation} dark={isArmed} />
        </View>
      </ScrollView>

      <Pressable
        style={({ pressed }) => [styles.askFab, pressed && styles.askFabPressed]}
        onPress={openAsk}
        testID="home-ask-fab"
        accessibilityRole="button"
        accessibilityLabel="Ask SheGuard AI assistant"
        accessibilityHint="Opens the SheGuard AI safety assistant chat"
        hitSlop={8}
      >
        <Image
          source={require('../../design/assets/sheguard_shield.png')}
          style={styles.askFabIcon}
          resizeMode="contain"
          accessible={false}
          accessibilityIgnoresInvertColors
        />
      </Pressable>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing.screenHorizontal, paddingTop: 12, paddingBottom: 24 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gapTop: { marginTop: 12 },
  sos: { alignItems: 'center', marginVertical: 16 },
  gap: { marginTop: 12 },
  disarm: {
    marginTop: 14,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disarmText: { color: colors.emergencyRed, fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  askFab: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primaryNavy,
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow,
  },
  askFabPressed: { opacity: 0.85 },
  askFabIcon: { width: 32, height: 32 },
});
