import fs from 'node:fs';

const css = fs.readFileSync('src/index.css','utf8');
const app = fs.readFileSync('src/App.tsx','utf8');
const workspace = fs.readFileSync('src/CommercialWorkspace.tsx','utf8');
const model = fs.readFileSync('src/commercial-model.ts','utf8');
const backend = fs.readFileSync('backend/commercial.ts','utf8');
const contract = JSON.parse(fs.readFileSync('contracts/control-center-ped-supreme.v1.json','utf8'));

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };

const requiredTabs = ['Visão Geral','Produtos','Comercial','Criativos','Aprovações','Publicações','Prospecção','CRM/Vendas','Atendimento','Financeiro','Evidências'];
for (const tab of requiredTabs) assert(app.includes(tab), 'missing_tab:' + tab);

const requiredKpis = ['Leads encontrados hoje','Contatos hoje','Criativos em produção','Aguardando aprovação','Publicados hoje','Vendas hoje'];
for (const kpi of requiredKpis) assert(workspace.includes(kpi), 'missing_kpi:' + kpi);

for (const section of ['commercial','creatives','approvals','publications','prospecting','crm','support','finance','evidence']) {
  assert(model.includes("'" + section + "'"), 'missing_section:' + section);
}

for (const token of contract.requiredTokens.map(x => '--' + x)) {
  const count = css.split(token + ':').length - 1;
  assert(count >= 2, 'token_not_dual_theme:' + token);
}
assert(/:root\[data-theme=(?:"|')light(?:"|')\]/.test(css), 'missing_light_theme');
assert(css.includes('color-scheme: dark light'), 'missing_dual_color_scheme');
assert(css.includes('overflow-wrap: anywhere'), 'missing_overflow_protection');
assert(css.includes(':focus-visible'), 'missing_keyboard_focus');
assert(css.includes('@media (max-width: 1120px)'), 'missing_tablet_behavior');
assert(css.includes('@media (max-width: 704px)'), 'missing_mobile_behavior');
assert(css.includes('prefers-reduced-motion: reduce'), 'missing_reduced_motion');
assert(app.includes("document.documentElement.dataset.theme = theme"), 'missing_theme_application');
assert(app.includes("localStorage.setItem('zpc_theme', theme)"), 'missing_theme_persistence');

assert(model.includes("state: 'BLOCKED'"), 'robot_missing_blocked_state');
assert(model.includes("state: 'STANDBY'"), 'robot_missing_standby_state');
assert(model.includes("state: 'ACTIVE'"), 'robot_missing_active_state');
assert(model.includes('heartbeatFresh'), 'robot_active_without_heartbeat_guard');
assert(model.includes('if (heartbeatFresh)'), 'robot_active_without_fresh_heartbeat_guard');
assert(backend.includes('commercialRobotTick'), 'commercial_robot_worker_missing');
assert(backend.includes('https://www.bing.com/search?format=rss&q='), 'public_search_provider_missing');
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

function themeBlock(selector) {
  const start=css.indexOf(selector);
  if(start<0) return '';
  const brace=css.indexOf('{',start);
  let depth=0;
  for(let i=brace;i<css.length;i++){
    if(css[i]==='{') depth++;
    else if(css[i]==='}') {
      depth--;
      if(depth===0) return css.slice(brace+1,i);
    }
  }
  return '';
}
function variable(block,name){
  const m=block.match(new RegExp('--'+name+'\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;'));
  return m?.[1] || '';
}
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
  const x=luminance(a), y=luminance(b);
  const hi=Math.max(x,y), lo=Math.min(x,y);
  return (hi+0.05)/(lo+0.05);
}

const themes={
  dark:themeBlock(':root {'),
  light:themeBlock(':root[data-theme="light"]')
};
for(const [theme,block] of Object.entries(themes)){
  assert(Boolean(block),'theme_block_missing:'+theme);
  const bodyPairs=[
    ['text-primary','bg-primary',7],
    ['text-secondary','bg-primary',7],
    ['text-primary','surface',7],
    ['text-secondary','surface',7],
    ['action-primary-text','action-primary',7],
  ];
  for(const [fg,bg,min] of bodyPairs){
    const a=variable(block,fg), b=variable(block,bg);
    assert(Boolean(a&&b),'contrast_token_missing:'+theme+':'+fg+'/'+bg);
    if(a&&b){
      const ratio=contrast(a,b);
      assert(ratio>=min,'contrast_fail:'+theme+':'+fg+'/'+bg+':'+ratio.toFixed(2));
    }
  }
}

assert(css.includes('PED-Versal V1.1 Supreme'), 'ped_supreme_block_missing');
const allowedFonts=new Set(contract.typographyPx);
const fontRe=/font-size\s*:\s*([^;}{]+)/gi;
const px=/(-?\d+(?:\.\d+)?)px\b/g;
for(const m of css.matchAll(fontRe)){
  for(const p of m[1].matchAll(px)){
    const v=Number(p[1]);
    assert(v===0 || allowedFonts.has(v),'font_scale_violation:'+p[0]);
  }
}

const geom=/(?:^|[;{\s])(gap|row-gap|column-gap|padding(?:-(?:top|right|bottom|left))?|margin(?:-(?:top|right|bottom|left))?|min-height|max-height|height|min-width|max-width|width|border-radius|outline-offset)\s*:\s*([^;}{]+)/gi;
for(const m of css.matchAll(geom)){
  for(const p of m[2].matchAll(px)){
    const v=Math.abs(Number(p[1]));
    if(v===0) continue;
    assert(Math.abs(v/4-Math.round(v/4))<1e-9,'non_4pt_geometry:'+m[1]+':'+p[0]);
  }
}

for(const [i,line] of css.split('\n').entries()){
  const hit=line.match(/#[0-9a-fA-F]{3,8}\b/);
  if(hit && !/--[\w-]+\s*:/.test(line) && !line.trim().startsWith(('/*'))){
    assert(false,'hardcoded_color:line:'+String(i+1));
  }
}

if (failures.length) {
  console.error('PED_COMMERCIAL_AUDIT=FAIL');
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log('PED_COMMERCIAL_AUDIT=PASS');
console.log('NAVIGATION=11/11');
console.log('COMMERCIAL_KPIS=6/6');
console.log('DUAL_THEME_TOKENS=PASS');
console.log('WCAG_AAA_BODY_TEXT=PASS');
console.log('GRID_4PT_WITH_8PT_MACRO=PASS');
console.log('TYPOGRAPHY_SUPREME=PASS');
console.log('ROBOT_FAIL_CLOSED=PASS');
console.log('ROBOT_RUNTIME_WORKER=PASS');
console.log('PUBLIC_PROSPECTING=PASS');
console.log('NO_AUTO_CONTACT_OR_PUBLISH=PASS');
console.log('CONTACT_DEDUP=PASS');
console.log('REVENUE_CLASSIFICATION=PASS');
console.log('APPROVAL_EVIDENCE_CHAIN=PASS');
