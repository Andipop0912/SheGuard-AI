import { ActivationState } from './ActivationState';
import { ActivationRequest } from './ActivationRequest';
import { ActivationResult } from './ActivationResult';

/**
 * Interface contract for activation manager.
 * Preserves Kotlin com.sheguardai.app.activation.ActivationManager interface.
 */
export interface ActivationManager {
  getActivationState(): ActivationState;
  getActiveSessionId(): string | null;
  subscribeState(listener: (state: ActivationState) => void): () => void;
  subscribeSession(listener: (sessionId: string | null) => void): () => void;
  handleActivation(request: ActivationRequest): Promise<ActivationResult>;
  stopProtection(): Promise<{ success: boolean; error?: Error }>;
  resetToInactive(): void;
}
