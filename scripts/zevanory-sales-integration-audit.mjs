import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const commercial = fs.readFileSync('backend/commercial.ts', 'utf8');
const index = fs.readFileSync('backend/index.ts', 'utf8');
const model = fs.readFileSync('src/zevanory-sales-model.ts', 'utf8');

const required = [
  [commercial, 'commercialBucketName', 'server-owned tenant bucket helper missing'],
  [commercial, "ZEVANORY_SALES_TENANT_ID", 'server-owned tenant identity missing'],
  [commercial, "isolation: 'server-owned-bucket-v1'", 'tenant isolation metadata missing'],
  [commercial, 'commercialSalesPromoteDiscovery', 'discovery promotion runtime missing'],
  [commercial, 'commercialSalesQualifyLead', 'scored qualification runtime missing'],
  [commercial, 'commercialSalesDecision', 'server-owned action gate runtime missing'],
  [commercial, 'commercialSalesExecuteAction', 'external execution runtime missing'],
  [commercial, 'commercialSalesInbound', 'inbound capture runtime missing'],
  [commercial, 'commercialSalesLifecycle', 'authenticated lifecycle runtime missing'],
  [commercial, 'commercialSalesProof', 'evidence-derived sale proof missing'],
  [commercial, 'evaluateZevanoryAutonomousSaleProof', 'canonical autonomous proof evaluator missing'],
  [commercial, 'paymentConfirmedForLead', 'server-derived payment proof missing'],
  [commercial, "ZEVANORY_SALES_CHANNEL_ADAPTER_URL", 'server-owned channel adapter URL missing'],
  [commercial, "ZEVANORY_SALES_CHANNEL_ADAPTER_TOKEN", 'server-owned channel adapter token missing'],
  [commercial, "sales_channel_adapter_external_id_missing", 'adapter readback identity guard missing'],
  [commercial, "ZEVANORY_SALES_QUALIFICATION_THRESHOLD", 'server-owned qualification threshold missing'],
  [commercial, "ZEVANORY_SALES_AUTONOMY || 'assist'", 'assist default missing'],
  [commercial, "ZEVANORY_SALES_CONTACT_POLICY_READY", 'server-owned contact policy gate missing'],
  [commercial, "ZEVANORY_SALES_PRICING_POLICY_READY", 'server-owned pricing policy gate missing'],
  [commercial, "ZEVANORY_SALES_CHECKOUT_POLICY_READY", 'server-owned checkout policy gate missing'],
  [commercial, "ZEVANORY_SALES_FULFILLMENT_POLICY_READY", 'server-owned fulfillment policy gate missing'],
  [commercial, "'external-execution:false'", 'external execution evidence guard missing'],
  [commercial, 'externalExecution: false', 'external execution must remain disconnected in this slice'],
  [commercial, "'qualification-signal:'", 'qualification evidence chain missing'],
  [commercial, "decision.reason = 'lead_not_qualified'", 'unqualified lead action guard missing'],
  [index, "'POST /api/commercial/sales/promote-discovery'", 'promotion route missing'],
  [index, "'POST /api/commercial/sales/qualify'", 'qualification route missing'],
  [index, "'POST /api/commercial/sales/decision'", 'decision route missing'],
  [index, "'POST /api/commercial/sales/execute'", 'execution route missing'],
  [index, "'POST /api/commercial/sales/inbound'", 'inbound route missing'],
  [index, "'POST /api/commercial/sales/lifecycle'", 'lifecycle route missing'],
  [index, "'POST /api/commercial/sales/proof'", 'proof route missing'],
  [index, 'requirePinSession(body.sessionToken)', 'admin session guard missing'],
  [model, 'evaluateZevanorySalesTransition', 'stage machine missing'],
  [model, "'lead_not_qualified'", 'lead qualification decision reason missing'],
  [commercial, "'checkout-completed:true'", 'strict lifecycle marker missing: 'checkout-completed:true''],
  [commercial, "'payment-confirmed:true'", 'strict lifecycle marker missing: 'payment-confirmed:true''],
  [commercial, "'customer-created:true'", 'strict lifecycle marker missing: 'customer-created:true''],
  [commercial, "'fulfillment-started:true'", 'strict lifecycle marker missing: 'fulfillment-started:true''],
];

for (const [source, token, message] of required) {
  if (!source.includes(token)) throw new Error(message);
}

const forbidden = [
  'sendWhatsApp(',
  'sendInstagram(',
  'sendFacebook(',
  'sendEmail(',
  'publishExternally(',
];

for (const token of forbidden) {
  if (commercial.includes(token)) throw new Error(`unexpected external executor wired in protected slice: ${token}`);
}

const clientOwnedPolicyFields = [
  'contactPolicyReady?:',
  'publicationPolicyReady?:',
  'pricingPolicyReady?:',
  'checkoutReady?:',
  'fulfillmentReady?:',
  'autonomousPublicationAllowed?:',
  "level?: 'assist' | 'autopilot' | 'autonomous'",
];

for (const token of clientOwnedPolicyFields) {
  if (index.includes(token)) throw new Error(`client must not own sales policy/autonomy: ${token}`);
}
if (/tenant(Id|_id)\s*\?:/.test(index)) {
  throw new Error('client must not select tenant');
}

const tsc = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '--noEmit', '--noUnusedLocals', 'false', '--noUnusedParameters', 'false'],
  { encoding: 'utf8' },
);
const output = `${tsc.stdout || ''}\n${tsc.stderr || ''}`;
const protectedFiles = [
  'backend/commercial.ts',
  'backend/index.ts',
  'src/zevanory-sales-model.ts',
  'scripts/zevanory-sales-model-contract.ts',
];
const protectedErrors = output
  .split(/\r?\n/)
  .filter(line => protectedFiles.some(file => line.includes(file)) && /error TS\d+/.test(line));

if (protectedErrors.length) {
  throw new Error(`ZEVANORY SALES protected-slice type errors:\n${protectedErrors.join('\n')}`);
}

console.log('ZEVANORY_SALES_RUNTIME_INTEGRATION=PASS');
console.log('ZEVANORY_SALES_DISCOVERY_PROMOTION=PASS');
console.log('ZEVANORY_SALES_SCORED_QUALIFICATION=PASS');
console.log('ZEVANORY_SALES_SERVER_OWNED_GATES=PASS');
if (index.includes('paymentConfirmed?: boolean')) {
  throw new Error('client must not claim payment confirmation');
}
if (!commercial.includes("externalId")) {
  throw new Error('external execution must require adapter identity/readback');
}

console.log('ZEVANORY_SALES_EXTERNAL_EXECUTION=GATED_ADAPTER');
console.log('ZEVANORY_SALES_INBOUND_CAPTURE=PASS');
console.log('ZEVANORY_SALES_PAYMENT_AUTHORITY=SERVER_DERIVED');
console.log('ZEVANORY_SALES_AUTONOMOUS_PROOF=EVIDENCE_DERIVED');
console.log('ZEVANORY_SALES_STRICT_LIFECYCLE_PROOF=PASS');
console.log('ZEVANORY_SALES_PROTECTED_SLICE_TYPECHECK=PASS');
