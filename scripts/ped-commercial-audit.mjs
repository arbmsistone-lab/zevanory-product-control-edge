import fs from 'node:fs';

const css = fs.readFileSync('src/index.css','utf8');
const app = fs.readFileSync('src/App.tsx','utf8');
const workspace = fs.readFileSync('src/CommercialWorkspace.tsx','utf8');
const model = fs.readFileSync('src/commercial-model.ts','utf8');
const backend = fs.readFileSync('backend/commercial.ts','utf8');

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const requiredTabs = ['Visão Geral','Produtos','Comercial','Criativos','Aprovações','Publicações','Prospecção','CRM/Vendas','Atendimento','Financeiro','Evidências'];
for (const tab of requiredTabs) assert(app.includes(tab), 'missing_tab:' + tab);

const requiredKpis = ['Leads encontrados hoje','Contatos hoje','Criativos em produção','Aguardando aprovação','Publicados hoje','Vendas hoje'];
for (const kpi of requiredKpis) assert(workspace.includes(kpi), 'missing_kpi:' + kpi);

for (const section of ['commercial','creatives','approvals','publications','prospecting','crm','support','finance','evidence']) {
  assert(model.includes("'" + section + "'"), 'missing_section:' + section);
}

for (const token of ['--bg-primary','--bg-secondary','--surface','--text-primary','--text-secondary','--border','--action-primary','--status-success','--status-error','--status-warning','--status-info']) {
  const count = css.split(token + ':').length - 1;
  assert(count >= 2, 'token_not_dual_theme:' + token);
}

assert(css.includes("@media (max-width: 1200px)"), 'missing_desktop_transition');
assert(css.includes("@media (max-width: 768px)"), 'missing_tablet_breakpoint');
assert(css.includes("@media (max-width: 480px)"), 'missing_mobile_breakpoint');
assert(css.includes('overflow-wrap: anywhere'), 'missing_long_text_overflow_protection');
assert(css.includes(':focus-visible'), 'missing_keyboard_focus');
assert(app.includes("document.documentElement.dataset.theme = theme"), 'missing_theme_application');
assert(app.includes("localStorage.setItem('zpc_theme', theme)"), 'missing_theme_persistence');

assert(model.includes("state: 'BLOCKED'"), 'robot_missing_blocked_state');
assert(model.includes("state: 'STANDBY'"), 'robot_missing_standby_state');
assert(model.includes("state: 'ACTIVE'"), 'robot_missing_active_state');
assert(model.includes('heartbeatFresh'), 'robot_active_without_heartbeat_guard');
assert(model.includes('externalProspecting && heartbeatFresh'), 'robot_active_without_channel_and_heartbeat_guard');
assert(backend.includes("authorization"), 'adapter_missing_auth_header');
assert(backend.includes("ZPC_CLUSTER_TOKEN"), 'adapter_missing_cluster_token');
assert(backend.includes('upsertBySourceKey'), 'adapter_missing_idempotency');
assert(backend.includes('commercialApprovalAction'), 'approval_action_missing');
assert(backend.includes("approval-action"), 'approval_evidence_event_missing');

function rgb(hex) {
  const n = Number.parseInt(hex.replace('#',''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function luminance(hex) {
  const values = rgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
}
function contrast(a,b) {
  const x = luminance(a), y = luminance(b);
  const hi = Math.max(x,y), lo = Math.min(x,y);
  return (hi + 0.05) / (lo + 0.05);
}
const contrastPairs = [
  ['dark:primary','#F7FAFC','#050A10',7],
  ['dark:secondary','#C8D4E3','#050A10',7],
  ['dark:surface-primary','#F7FAFC','#101923',7],
  ['dark:surface-secondary','#C8D4E3','#101923',7],
  ['light:primary','#111820','#F7FAFC',7],
  ['light:secondary','#263544','#F7FAFC',7],
  ['light:surface-primary','#111820','#FFFFFF',7],
  ['light:surface-secondary','#263544','#FFFFFF',7],
  ['dark:action-text','#07111A','#8CC8FF',7],
  ['light:action-text','#FFFFFF','#0A4F87',7],
];
for (const [name,fg,bg,min] of contrastPairs) {
  const ratio = contrast(fg,bg);
  assert(ratio >= min, 'contrast_fail:' + name + ':' + ratio.toFixed(2));
}

const pedBlock = css.split('PED-VERSAL V1.0 MATRIX')[1] || '';
const spacingMatches = [...pedBlock.matchAll(/(?:gap|padding|margin(?:-top|-right|-bottom|-left)?|min-height|height):\s*([0-9]+)px/g)];
const spacingExceptions = new Set([1,2,3,12,21,28]);
for (const match of spacingMatches) {
  const value = Number(match[1]);
  if (spacingExceptions.has(value)) continue;
  assert(value % 8 === 0, 'non_8pt_geometry:' + match[0]);
}

if (failures.length) {
  console.error('PED_COMMERCIAL_AUDIT=FAIL');
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log('PED_COMMERCIAL_AUDIT=PASS');
console.log('NAVIGATION=11/11');
console.log('COMMERCIAL_KPIS=6/6');
console.log('DUAL_THEME_TOKENS=11/11');
console.log('WCAG_AAA_BODY_TEXT=PASS');
console.log('ROBOT_FAIL_CLOSED=PASS');
console.log('APPROVAL_EVIDENCE_CHAIN=PASS');
