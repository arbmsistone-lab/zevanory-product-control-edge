import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const commercial = fs.readFileSync('backend/commercial.ts', 'utf8');
const index = fs.readFileSync('backend/index.ts', 'utf8');
const model = fs.readFileSync('src/zevanory-sales-model.ts', 'utf8');

const required = [
  [commercial, 'commercialSalesQualifyLead', 'qualification runtime missing'],
  [commercial, 'commercialSalesEvaluateAction', 'action gate runtime missing'],
  [commercial, "execution: 'not-executed'", 'external execution must remain disconnected in this slice'],
  [commercial, "sales-action-blocked", 'blocked action evidence missing'],
  [commercial, "sales-action-allowed", 'allowed action evidence missing'],
  [commercial, "qualification-signal:", 'qualification evidence chain missing'],
  [commercial, "commercial_lead_not_found", 'lead existence guard missing'],
  [index, "'POST /api/commercial/sales/qualify'", 'qualification route missing'],
  [index, "'POST /api/commercial/sales/evaluate-action'", 'action route missing'],
  [index, 'requirePinSession(body.sessionToken)', 'admin session guard missing'],
  [model, "'lead_not_qualified'", 'unqualified lead reason missing'],
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
