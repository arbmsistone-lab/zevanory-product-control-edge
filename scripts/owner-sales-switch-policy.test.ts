import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessOwnerSalesSwitchRequest as decide } from '../cf-worker/sales-switch-owner-policy.ts';

// A missing/malformed "open" must never mutate the production KV switch.
for (const input of [undefined, null, {}, [], { open: null }, { open: 'false' }, { open: 0 }, { open: false }]) {
  assert.equal(decide(input).ok, false, JSON.stringify(input));
}
assert.deepEqual(decide({ open: true, closeConfirmation: 'FECHAR VENDAS' }), {
  ok: false, error: 'open_workflow_only', status: 403,
});
assert.deepEqual(decide({ open: false, closeConfirmation: 'FECHAR VENDAS' }), {
  ok: true, reason: 'OWNER_MANUAL_CLOSE',
});

const worker = readFileSync(new URL('../cf-worker/worker.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/CommercialWorkspace.tsx', import.meta.url), 'utf8');
assert.match(worker, /assessOwnerSalesSwitchRequest\(body\)/);
assert.match(worker, /reason: decision\.reason/);
assert.match(worker, /normalizedPath === '\/api\/sales\/state' && request\.method === 'GET'/);
assert.match(ui, /closeConfirmation: 'FECHAR VENDAS'/);
assert.match(ui, /Confirmar fechamento/);
assert.doesNotMatch(ui, /toggle\(true\)|Confirmar abertura|onClick=\{\(\) => void toggle\(false\)\}/);
console.log('OWNER_SALES_SWITCH_INTENT=PASS');
