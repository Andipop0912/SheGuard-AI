import { ActivationManagerImpl } from '../../src/activation/services/ActivationManagerImpl';
import { ActivationState } from '../../src/activation/domain/ActivationState';
import { ActivationSource } from '../../src/activation/domain/ActivationSource';
import { ActivationRequest } from '../../src/activation/domain/ActivationRequest';

describe('ActivationManagerTest', () => {
  let manager: ActivationManagerImpl;

  beforeEach(() => {
    manager = new ActivationManagerImpl();
  });

  test('initial state is inactive', () => {
    expect(manager.getActivationState()).toBe(ActivationState.INACTIVE);
    expect(manager.getActiveSessionId()).toBeNull();
  });

  test('user initiated activation starts protection', async () => {
    const request: ActivationRequest = {
      requestId: 'request-1',
      source: ActivationSource.MOCK,
      requestedAt: 100,
      userInitiated: true,
    };

    const result = await manager.handleActivation(request);

    expect(result.type).toBe('Started');
    if (result.type === 'Started') {
      expect(result.sessionId).toBeDefined();
    }

    expect(manager.getActivationState()).toBe(ActivationState.ACTIVE);
    expect(manager.getActiveSessionId()).not.toBeNull();
  });

  test('non user initiated activation is rejected', async () => {
    const request: ActivationRequest = {
      requestId: 'request-2',
      source: ActivationSource.MOCK,
      requestedAt: 100,
      userInitiated: false,
    };

    const result = await manager.handleActivation(request);

    expect(result.type).toBe('Rejected');
    if (result.type === 'Rejected') {
      expect(result.reason).toBe('Activation must be user initiated.');
    }

    expect(manager.getActivationState()).toBe(ActivationState.ERROR);
  });

  test('duplicate activation is rejected while active', async () => {
    const firstRequest: ActivationRequest = {
      requestId: 'request-1',
      source: ActivationSource.MOCK,
      requestedAt: 100,
      userInitiated: true,
    };

    const secondRequest: ActivationRequest = {
      requestId: 'request-2',
      source: ActivationSource.MOCK,
      requestedAt: 200,
      userInitiated: true,
    };

    await manager.handleActivation(firstRequest);
    const result = await manager.handleActivation(secondRequest);

    expect(result.type).toBe('Rejected');
    if (result.type === 'Rejected') {
      expect(result.reason).toBe('Protection session is already active.');
    }

    expect(manager.getActivationState()).toBe(ActivationState.ACTIVE);
  });

  test('stop protection returns to inactive', async () => {
    const request: ActivationRequest = {
      requestId: 'request-1',
      source: ActivationSource.MOCK,
      requestedAt: 100,
      userInitiated: true,
    };

    await manager.handleActivation(request);
    const result = await manager.stopProtection();

    expect(result.success).toBe(true);
    expect(manager.getActivationState()).toBe(ActivationState.INACTIVE);
    expect(manager.getActiveSessionId()).toBeNull();
  });

  test('stopping without active session fails', async () => {
    const result = await manager.stopProtection();

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('No active protection session exists.');
    expect(manager.getActivationState()).toBe(ActivationState.INACTIVE);
  });

  test('reset to inactive clears active session', async () => {
    const request: ActivationRequest = {
      requestId: 'request-1',
      source: ActivationSource.MOCK,
      requestedAt: 100,
      userInitiated: true,
    };

    await manager.handleActivation(request);
    expect(manager.getActivationState()).toBe(ActivationState.ACTIVE);

    manager.resetToInactive();

    expect(manager.getActivationState()).toBe(ActivationState.INACTIVE);
    expect(manager.getActiveSessionId()).toBeNull();
  });
});
