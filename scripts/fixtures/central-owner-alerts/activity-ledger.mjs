// Test stub for the central Worker's activity ledger (zevanory-public-mirror worker/activity-ledger.mjs): records calls only.
export const emitted = [];
export async function emitActivity(_env, event) { emitted.push(event); return { ok: true }; }
