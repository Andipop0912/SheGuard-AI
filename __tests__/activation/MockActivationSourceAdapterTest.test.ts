import { MockActivationSourceAdapter } from '../../src/activation/services/MockActivationSourceAdapter';
import { ActivationSource } from '../../src/activation/domain/ActivationSource';
import { ActivationRequest } from '../../src/activation/domain/ActivationRequest';

describe('MockActivationSourceAdapterTest', () => {
  test('activation is rejected when source is not listening', () => {
    const adapter = new MockActivationSourceAdapter();
    const emitted = adapter.simulateActivation();
    expect(emitted).toBe(false);
  });

  test('activation is emitted when source is listening', (done) => {
    const adapter = new MockActivationSourceAdapter();
    adapter.startListening();

    const unsubscribe = adapter.observeRequests((request: ActivationRequest) => {
      expect(request.source).toBe(ActivationSource.MOCK);
      expect(request.userInitiated).toBe(true);
      expect(request.requestId).toBeDefined();
      unsubscribe();
      adapter.stopListening();
      done();
    });

    const emitted = adapter.simulateActivation();
    expect(emitted).toBe(true);
  });

  test('source stops emitting after listening is stopped', () => {
    const adapter = new MockActivationSourceAdapter();
    adapter.startListening();
    adapter.stopListening();

    const emitted = adapter.simulateActivation();
    expect(emitted).toBe(false);
  });

  test('activation can be marked as not user initiated', (done) => {
    const adapter = new MockActivationSourceAdapter();
    adapter.startListening();

    const unsubscribe = adapter.observeRequests((request: ActivationRequest) => {
      expect(request.source).toBe(ActivationSource.MOCK);
      expect(request.userInitiated).toBe(false);
      unsubscribe();
      adapter.stopListening();
      done();
    });

    const emitted = adapter.simulateActivation(false);
    expect(emitted).toBe(true);
  });
});
