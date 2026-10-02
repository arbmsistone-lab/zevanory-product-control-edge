import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const commercial = fs.readFileSync('backend/commercial.ts', 'utf8');
const index = fs.readFileSync('backend/index.ts', 'utf8');
const model = fs.readFileSync('src/zevanory-sales-model.ts', 'utf8');

const required = [
  [commercial, 'commercialQualifyDiscovery', 'qualification runtime missing'],
  [commercial, 'commercialSalesDecision', 'action gate runtime missing'],
  [commercial, "externalExecution: false", 'external execution must remain disconnected in this slice'],
  [commercial, "sales-decision-blocked", 'blocked action evidence missing'],
  [commercial, "sales-decision-allowed", 'allowed action evidence missing'],
  [commercial, "qualification:human-reviewed", 'qualification evidence chain missing'],
  [commercial, "sales_lead_not_found", 'lead existence guard missing'],
  [index, "'POST /api/commercial/sales/qualify'", 'qualification route missing'],
  [index, "'POST /api/commercial/sales/decision'", 'action route missing'],
  [index, 'requirePinSession(body.sessionToken)', 'admin session guard missing'],
  [commercial, "sales_lead_not_qualified", 'unqualified lead action guard missing'],
  [commercial, "ZEVANORY_SALES_CONTACT_POLICY_READY", 'server-owned contact policy gate missing'],
  [commercial, "ZEVANORY_SALES_PRICING_POLICY_READY", 'server-owned pricing policy gate missing'],
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
console.log('ZEVANORY_SALES_EXTERNAL_EXECUTION=DISCONNECTED');
console.log('ZEVANORY_SALES_PROTECTED_SLICE_TYPECHECK=PASS');
