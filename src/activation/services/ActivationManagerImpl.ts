import { ActivationManager } from '../domain/ActivationManager';
import { ActivationState } from '../domain/ActivationState';
import { ActivationRequest } from '../domain/ActivationRequest';
import { ActivationResult } from '../domain/ActivationResult';

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export class ActivationManagerImpl implements ActivationManager {
  private currentState: ActivationState = ActivationState.INACTIVE;
  private currentSessionId: string | null = null;

  private stateListeners: Set<(state: ActivationState) => void> = new Set();
  private sessionListeners: Set<(sessionId: string | null) => void> = new Set();

  public getActivationState(): ActivationState {
    return this.currentState;
  }

  public getActiveSessionId(): string | null {
    return this.currentSessionId;
  }

  public subscribeState(listener: (state: ActivationState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.currentState);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  public subscribeSession(listener: (sessionId: string | null) => void): () => void {
    this.sessionListeners.add(listener);
    listener(this.currentSessionId);
    return () => {
      this.sessionListeners.delete(listener);
    };
  }

  private setState(state: ActivationState): void {
    this.currentState = state;
    this.stateListeners.forEach((listener) => listener(state));
  }

  private setSessionId(sessionId: string | null): void {
    this.currentSessionId = sessionId;
    this.sessionListeners.forEach((listener) => listener(sessionId));
  }

  public async handleActivation(request: ActivationRequest): Promise<ActivationResult> {
    if (!request.userInitiated) {
      this.setState(ActivationState.ERROR);
      return {
        type: 'Rejected',
        reason: 'Activation must be user initiated.',
      };
    }

    if (this.currentState === ActivationState.ACTIVE) {
      return {
        type: 'Rejected',
        reason: 'Protection session is already active.',
      };
    }

    this.setState(ActivationState.ACTIVATION_RECEIVED);
    this.setState(ActivationState.CHECKING_PERMISSIONS);
    this.setState(ActivationState.READY_TO_START);
    this.setState(ActivationState.STARTING);

    const sessionId = generateUUID();
    this.setSessionId(sessionId);
    this.setState(ActivationState.ACTIVE);

    return {
      type: 'Started',
      sessionId,
    };
  }

  public async stopProtection(): Promise<{ success: boolean; error?: Error }> {
    if (this.currentState !== ActivationState.ACTIVE) {
      return {
        success: false,
        error: new Error('No active protection session exists.'),
      };
    }

    this.setState(ActivationState.STOPPING);
    this.setSessionId(null);
    this.setState(ActivationState.INACTIVE);

    return { success: true };
  }

  public resetToInactive(): void {
    this.setSessionId(null);
    this.setState(ActivationState.INACTIVE);
  }
}
