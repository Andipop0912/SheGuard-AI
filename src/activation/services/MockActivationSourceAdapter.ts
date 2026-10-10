import { ActivationSourceAdapter } from '../domain/ActivationSourceAdapter';
import { ActivationRequest } from '../domain/ActivationRequest';
import { ActivationSource } from '../domain/ActivationSource';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class MockActivationSourceAdapter implements ActivationSourceAdapter {
  private listening = false;
  private listeners: Set<(request: ActivationRequest) => void> = new Set();

  public startListening(): void {
    this.listening = true;
  }

  public stopListening(): void {
    this.listening = false;
  }

  public observeRequests(listener: (request: ActivationRequest) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public simulateActivation(userInitiated: boolean = true): boolean {
    if (!this.listening) {
      return false;
    }

    const request: ActivationRequest = {
      requestId: generateUUID(),
      source: ActivationSource.MOCK,
      requestedAt: Date.now(),
      userInitiated,
    };

    this.listeners.forEach((listener) => listener(request));
    return true;
  }
}
