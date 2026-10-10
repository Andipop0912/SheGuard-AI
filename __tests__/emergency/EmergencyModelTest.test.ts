import { createEmergencyEvent } from '../../src/emergency/domain/EmergencyEvent';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';
import { SyncStatus } from '../../src/emergency/domain/SyncStatus';
import { AppContainer } from '../../src/app/di/AppContainer';

describe('EmergencyModelTest', () => {
  test('emergency event default values are correctly populated', () => {
    const event = createEmergencyEvent({
      eventId: 'evt-123',
      userId: 'user-456',
      deviceId: 'dev-789',
      triggerSource: EmergencyTriggerSource.MANUAL_SOS,
    });

    expect(event.eventId).toBe('evt-123');
    expect(event.userId).toBe('user-456');
    expect(event.deviceId).toBe('dev-789');
    expect(event.triggerSource).toBe(EmergencyTriggerSource.MANUAL_SOS);
    expect(event.state).toBe(EmergencyState.TRIGGERED);
    expect(event.syncStatus).toBe(SyncStatus.PENDING);
    expect(event.resolvedAt).toBeNull();
  });

  test('app container lazily initializes dependencies', () => {
    const container = AppContainer.getInstance();
    expect(container.activationManager).toBeDefined();
    expect(container.mockActivationSource).toBeDefined();
    expect(container.emergencyRepository).toBeDefined();
    expect(container.emergencyCoordinator).toBeDefined();
  });
});
