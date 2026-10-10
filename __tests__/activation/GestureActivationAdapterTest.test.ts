import { GestureActivationAdapter } from '../../src/activation/services/GestureActivationAdapter';
import { ActivationState } from '../../src/activation/domain/ActivationState';
import { EmergencyTriggerSource } from '../../src/emergency/domain/EmergencyTriggerSource';
import { getEventOwner } from '../../src/app/identity';
import { EmergencyState } from '../../src/emergency/domain/EmergencyState';

describe('GestureActivationAdapter & Shake Architecture Tests', () => {
  let adapter: GestureActivationAdapter;
  let mockActivationState: ActivationState;
  let mockEmergencyCoordinator: any;
  let triggeredEvents: any[];
  let observedRequests: any[];

  beforeEach(() => {
    mockActivationState = ActivationState.ACTIVE;
    triggeredEvents = [];
    observedRequests = [];

    mockEmergencyCoordinator = {
      triggerEmergency: jest.fn().mockImplementation(async (userId, deviceId, source) => {
        const event = { eventId: `evt-test-${Date.now()}`, userId, deviceId, triggerSource: source, state: EmergencyState.TRIGGERED };
        triggeredEvents.push(event);
        return event;
      }),
    };

    const mockActivationManager = {
      getActivationState: () => mockActivationState,
    };

    adapter = new GestureActivationAdapter(
      () => mockActivationManager as any,
      () => mockEmergencyCoordinator as any
    );
    adapter.observeRequests((req) => observedRequests.push(req));
  });

  afterEach(() => {
    adapter.stopListening();
  });

  test('1. Start and stop listening updates internal listener state cleanly', () => {
    expect(adapter.getIsListening()).toBe(false);
    adapter.startListening();
    expect(adapter.getIsListening()).toBe(true);
    adapter.stopListening();
    expect(adapter.getIsListening()).toBe(false);
  });

  test('2. Repeated start/stop calls do not create duplicate listeners or leak state', () => {
    adapter.startListening();
    adapter.startListening();
    expect(adapter.getIsListening()).toBe(true);
    adapter.stopListening();
    adapter.stopListening();
    expect(adapter.getIsListening()).toBe(false);
  });

  test('3. ARM OFF (ActivationState.INACTIVE) -> native shake trigger is REJECTED', async () => {
    mockActivationState = ActivationState.INACTIVE; // ARM is OFF
    adapter.startListening();

    const result = await adapter.handleGestureDetected();
    expect(result).toBe(false);
    expect(mockEmergencyCoordinator.triggerEmergency).not.toHaveBeenCalled();
    expect(observedRequests.length).toBe(0);
    expect(triggeredEvents.length).toBe(0);
  });

  test('4. ARM ON (ActivationState.ACTIVE) -> native shake trigger is ACCEPTED and dispatches EmergencyTriggerSource.GESTURE', async () => {
    mockActivationState = ActivationState.ACTIVE; // ARM is ON
    adapter.startListening();

    const result = await adapter.handleGestureDetected();
    expect(result).toBe(true);
    expect(observedRequests.length).toBe(1);
    expect(observedRequests[0].source).toBe('PHONE_GESTURE');
    // Owner comes from identity.ts (signed out here → unclaimed; device id not loaded in this test).
    expect(mockEmergencyCoordinator.triggerEmergency).toHaveBeenCalledWith(
      getEventOwner().userId,
      getEventOwner().deviceId,
      EmergencyTriggerSource.GESTURE
    );
    expect(triggeredEvents.length).toBe(1);
  });

  test('5. Simulation helper correctly triggers handleGestureDetected path', async () => {
    mockActivationState = ActivationState.ACTIVE;
    const result = await adapter.simulateShakeTrigger();
    expect(result).toBe(true);
    expect(triggeredEvents.length).toBe(1);
  });
});
