import { useActivationStore } from '../activation/store/activationStore';
import { useEmergencyStore } from '../emergency/store/emergencyStore';
import { useLocationStore } from '../location/store/locationStore';
import { useVoiceStore } from '../voice/store/voiceStore';
import { useEvidenceStore } from '../evidence/store/evidenceStore';
import { useRouteSafetyStore } from '../routesafety/store/routeSafetyStore';
import { useAuthStore } from '../auth/store/authStore';
import { startServerSync } from '../sync/startServerSync';
import { AppContainer } from './di/AppContainer';
import { loadInstallDeviceId } from './identity';

let started: Promise<void> | null = null;

/**
 * Starts the existing safety core once per JS runtime (previously done by the developer screen):
 * ActivationManager subscription + ARM-gated shake wiring, the emergency location controller,
 * EmergencyCoordinator observation/restore, and the ARM-independent voice service; then the
 * install identity, the stored session and background server sync.
 * Each step is isolated: a failure in one never prevents the others (or SOS).
 */
export function bootstrapSafetyCore(): Promise<void> {
  if (!started) started = run();
  return started;
}

async function run(): Promise<void> {
  const step = async (name: string, work: () => unknown) => {
    try {
      await work();
    } catch (e) {
      console.warn(`[bootstrap] ${name} failed`, e);
    }
  };

  await step('activation', () => useActivationStore.getState().startActivationSource());
  await step('location', () => useLocationStore.getState().initialize());
  await step('emergency', () => useEmergencyStore.getState().initialize());
  await step('voice', () => useVoiceStore.getState().startVoiceListening());
  await step('evidence', () => useEvidenceStore.getState().initialize());
  await step('route-safety', () => useRouteSafetyStore.getState().initialize());

  // Server connection starts only after the safety core is running, and failures here never
  // affect it: sign-in state and backup only decide whether emergencies are uploaded.
  await step('identity', () => loadInstallDeviceId());
  await step('auth', async () => {
    useAuthStore.getState().initialize();
    await AppContainer.getInstance().authService.restore();
  });
  await step('server-sync', () => startServerSync());
}

/** Tests only. */
export function resetBootstrapForTesting(): void {
  started = null;
}
