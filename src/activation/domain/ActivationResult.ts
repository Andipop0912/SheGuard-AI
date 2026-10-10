/**
 * Discriminated union type representing activation outcomes.
 * Preserves Kotlin com.sheguardai.app.activation.ActivationResult sealed interface.
 */
export type ActivationResult =
  | { type: 'Started'; sessionId: string }
  | { type: 'Rejected'; reason: string }
  | { type: 'PermissionRequired'; permission: string }
  | { type: 'Failed'; code: string; message: string };
