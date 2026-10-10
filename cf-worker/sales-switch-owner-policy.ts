/** Fail-closed owner switch contract. Never infer an emergency action from absent JSON fields. */
export type OwnerSalesSwitchDecision =
  | { ok: true; reason: 'OWNER_MANUAL_CLOSE' }
  | { ok: false; error: 'explicit_action_required' | 'open_workflow_only' | 'close_confirmation_required'; status: 400 | 403 | 409 };

export function assessOwnerSalesSwitchRequest(body: unknown): OwnerSalesSwitchDecision {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'explicit_action_required', status: 400 };
  }
  const input = body as Record<string, unknown>;
  if (typeof input.open !== 'boolean') {
    return { ok: false, error: 'explicit_action_required', status: 400 };
  }
  if (input.open) {
    return { ok: false, error: 'open_workflow_only', status: 403 };
  }
  if (input.closeConfirmation !== 'FECHAR VENDAS') {
    return { ok: false, error: 'close_confirmation_required', status: 409 };
  }
  return { ok: true, reason: 'OWNER_MANUAL_CLOSE' };
}
