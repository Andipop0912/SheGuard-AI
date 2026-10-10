import { ActivationRequest } from './ActivationRequest';

/**
 * Interface contract for activation sources (Mock, Gesture, Hardware button, etc.).
 * Preserves Kotlin com.sheguardai.app.activation.ActivationSourceAdapter flow subscriber pattern.
 */
export interface ActivationSourceAdapter {
  startListening(): void;
  stopListening(): void;
  observeRequests(listener: (request: ActivationRequest) => void): () => void;
}
