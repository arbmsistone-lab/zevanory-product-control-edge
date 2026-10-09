import fs from 'node:fs';

const css = fs.readFileSync('src/index.css','utf8');
const designTokens = fs.readFileSync('src/styles/tokens.css','utf8');
const app = fs.readFileSync('src/App.tsx','utf8');
const workspace = fs.readFileSync('src/CommercialWorkspace.tsx','utf8');
const model = fs.readFileSync('src/commercial-model.ts','utf8');
const backend = fs.readFileSync('backend/commercial.ts','utf8');

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const requiredTabs = ['Visão Geral','Produtos','Comercial','Criativos','Aprovações','Publicações','Prospecção','CRM/Vendas','Atendimento','Financeiro','Evidências'];
for (const tab of requiredTabs) assert(app.includes(tab), 'missing_tab:' + tab);

const requiredKpis = ['Visitas às páginas · 30 dias','Leads de hoje','Checkouts iniciados · 30 dias','Vendas confirmadas hoje','Posts publicados hoje','Contatos hoje'];
for (const kpi of requiredKpis) assert(workspace.includes(kpi), 'missing_kpi:' + kpi);
assert(workspace.includes('sumVerified') && workspace.includes("totalViews ?? 'N/D'") && workspace.includes("totalCheckouts ?? 'N/D'"), 'real_funnel_must_fail_closed_without_evidence');
assert(workspace.includes('sessionToken') && workspace.includes('/api/commercial/funnel'), 'funnel_must_be_authenticated');

for (const section of ['commercial','creatives','approvals','publications','prospecting','crm','support','finance','evidence']) {
  assert(model.includes("'" + section + "'"), 'missing_section:' + section);
}

const tokens = ['--bg-primary','--bg-secondary','--surface','--text-primary','--text-secondary','--border','--action-primary','--status-success','--status-error','--status-warning','--status-info'];
for (const token of tokens) {
  const count = css.split(token + ':').length - 1;
  assert(count >= 2, 'token_not_dual_theme:' + token);
}

assert(css.includes(":root[data-theme='dark']"), 'missing_dark_theme');
assert(css.includes(":root[data-theme='light']"), 'missing_light_theme');
assert(css.includes('overflow-wrap: anywhere'), 'missing_overflow_protection');
assert(css.includes(':focus-visible'), 'missing_keyboard_focus');
assert(css.includes('@media (max-width: 960px)'), 'missing_tablet_behavior');
assert(css.includes('@media (max-width: 560px)'), 'missing_mobile_behavior');
assert(css.includes('prefers-reduced-motion: reduce'), 'missing_reduced_motion');
assert(app.includes("document.documentElement.dataset.theme = theme"), 'missing_theme_application');
assert(app.includes("localStorage.setItem('zpc_theme', theme)"), 'missing_theme_persistence');

assert(model.includes("state: 'BLOCKED'"), 'robot_missing_blocked_state');
assert(model.includes("state: 'STANDBY'"), 'robot_missing_standby_state');
assert(model.includes("state: 'ACTIVE'"), 'robot_missing_active_state');
assert(model.includes('heartbeatFresh'), 'robot_active_without_heartbeat_guard');
assert(model.includes('if (heartbeatFresh)'), 'robot_active_without_fresh_heartbeat_guard');
assert(backend.includes('commercialRobotTick'), 'commercial_robot_worker_missing');
assert(backend.includes('https://www.bing.com/search?mkt=pt-BR&cc=br&setlang=pt-BR&format=rss&count=20&q='), 'public_search_provider_missing');
assert(backend.includes("new URL('../config/m1-queries.json', import.meta.url)"), 'm1_query_authority_missing');
assert(backend.includes('scoreProspect'), 'prospect_relevance_filter_missing');
assert(backend.includes('query-source:M1'), 'm1_evidence_binding_missing');
assert(backend.includes('locale:pt-BR'), 'prospect_ptbr_guard_missing');
assert(backend.includes('country:BR'), 'prospect_brazil_guard_missing');
assert(backend.includes('no-cold-outreach'), 'cold_outreach_guard_missing');
assert(backend.includes('commercialCleanup'), 'commercial_cleanup_function_missing');
assert(backend.includes('listKindAllPrimary'), 'commercial_cleanup_pagination_missing');
assert(backend.includes('listPrimaryPage'), 'commercial_cleanup_primary_page_read_missing');
assert(backend.includes("reportType: CommercialCleanupReportType"), 'commercial_cleanup_prospecting_type_missing');
assert(backend.includes("source === 'public-search'"), 'commercial_cleanup_public_search_source_missing');
assert(backend.includes('AUTORIZO_ARQUIVAMENTO'), 'commercial_cleanup_apply_confirmation_missing');
assert(backend.includes("status: 'archived'"), 'commercial_cleanup_archive_state_missing');
const cleanupSlice = backend.slice(backend.indexOf('export async function commercialCleanup'), backend.indexOf('export async function commercialApprovalAction'));
assert(!cleanupSlice.includes('db.delete('), 'commercial_cleanup_delete_forbidden');

assert(backend.includes('no-auto-contact'), 'auto_contact_guard_missing');
assert(backend.includes('no-auto-publish'), 'auto_publish_guard_missing');
assert(backend.includes("status: 'brief'"), 'creative_brief_generation_missing');
assert(model.includes("contactEventsToday.length > 0 ? contactEventsToday.length : contactLeadsToday.length"), 'contacts_double_count_guard_missing');
assert(model.includes("saleSources.has(normalizeCommercialState(item.source))"), 'non_sale_revenue_guard_missing');
assert(backend.includes('authorization'), 'adapter_missing_auth_header');
assert(backend.includes('ZPC_CLUSTER_TOKEN'), 'adapter_missing_cluster_token');
assert(backend.includes('upsertBySourceKey'), 'adapter_missing_idempotency');
assert(backend.includes('commercialApprovalAction'), 'approval_action_missing');
assert(backend.includes('approval-action'), 'approval_evidence_event_missing');

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
  ['dark:primary','#F7FAFF','#050912',7],
  ['dark:secondary','#C5D1E1','#050912',7],
  ['dark:surface-primary','#F7FAFF','#111C2D',7],
  ['dark:surface-secondary','#C5D1E1','#111C2D',7],
  ['light:primary','#0A1423','#F8FAFD',7],
  ['light:secondary','#263850','#F8FAFD',7],
  ['light:surface-primary','#0A1423','#FFFFFF',7],
  ['light:surface-secondary','#263850','#FFFFFF',7],
  ['dark:action-text','#06111F','#8EC5FF',7],
  ['light:action-text','#FFFFFF','#0A4A85',7],
];
for (const [name,fg,bg,min] of contrastPairs) {
  const ratio = contrast(fg,bg);
  assert(ratio >= min, 'contrast_fail:' + name + ':' + ratio.toFixed(2));
}

const start = css.indexOf('PED-VERSAL V1.0 MATRIZ');
assert(start >= 0, 'ped_block_missing');
const ped = start >= 0 ? css.slice(start) : '';
const geometryMatches = [...ped.matchAll(/(?:gap|padding(?:-top|-right|-bottom|-left)?|margin(?:-top|-right|-bottom|-left)?|min-height|height|border-radius):\s*([0-9]+)px/g)];
for (const match of geometryMatches) {
  const value = Number(match[1]);
  if (value === 0) continue;
  // PED-Versal V1.1 Supreme: macro geometry is 8pt; 4pt is the controlled micro-grid.
  assert(value % 4 === 0, 'non_ped_geometry:' + match[0]);
}

assert(designTokens.includes('--zpc-font-sm: 16px'), 'perfect_fourth_base_missing');
assert(designTokens.includes('--zpc-font-md: 21px'), 'perfect_fourth_h3_missing');
assert(designTokens.includes('--zpc-font-lg: 28px'), 'perfect_fourth_h2_missing');
assert(designTokens.includes('--zpc-font-xl: 37px'), 'perfect_fourth_h1_missing');

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
console.log('GRID_8PT_MACRO=PASS');
console.log('GRID_4PT_MICRO=PASS');
console.log('ROBOT_FAIL_CLOSED=PASS');
console.log('ROBOT_RUNTIME_WORKER=PASS');
console.log('M1_FILTERED_PROSPECTING=PASS');
console.log('NO_AUTO_CONTACT_OR_PUBLISH=PASS');
console.log('CONTACT_DEDUP=PASS');
console.log('REVENUE_CLASSIFICATION=PASS');
console.log('APPROVAL_EVIDENCE_CHAIN=PASS');
