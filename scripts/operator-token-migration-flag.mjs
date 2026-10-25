// R9-D1: validation of the non-secret migration-window flag for the control Worker deploy. Same name, same format and
// same code ceiling as the main Worker deploy (zevanory-public-mirror scripts/deploy/prepare-central-candidate.py).
//   absent           -> no --var (window closed: today's behaviour)
//   YYYY-MM-DD <= ceiling (real calendar day) -> --var OPERATOR_TOKEN_MIGRATION_UNTIL:<day>
//   anything else    -> throws OPERATOR_TOKEN_MIGRATION_UNTIL_INVALID (deploy refused)
// An expired date is accepted (the Worker treats it as closed); the code never extends or rewrites the date.
export const MIGRATION_FLAG_NAME = 'OPERATOR_TOKEN_MIGRATION_UNTIL';
export const MIGRATION_CODE_CEILING = '2026-12-31';
const PINNED = /^\s*(OPERATOR_TOKEN_MIGRATION_UNTIL|ZEVANORY_OPERATOR_TOKEN|CERTIFICATION_E2E_TOKEN|COMMERCIAL_ROBOT_TICK_SECRET)\s*=/m;

export function migrationFlagVarArgs(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { state: 'absent', args: [] };
  const t = Date.parse(value + 'T23:59:59.999Z');
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
  if (!valid || value > MIGRATION_CODE_CEILING) throw new Error('OPERATOR_TOKEN_MIGRATION_UNTIL_INVALID');
  return { state: 'set', until: value, args: ['--var', MIGRATION_FLAG_NAME + ':' + value] };
}

// The wrangler config must never pin the flag or any credential name as a plain var.
export function assertWranglerConfigHasNoCredentialVars(tomlText) {
  if (PINNED.test(String(tomlText || ''))) throw new Error('WRANGLER_CONFIG_MUST_NOT_PIN_CREDENTIAL_NAMES');
}
