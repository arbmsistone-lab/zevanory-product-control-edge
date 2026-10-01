import fs from 'node:fs';

const app = fs.readFileSync('src/App.tsx','utf8');
const workspace = fs.readFileSync('src/CfoWorkspace.tsx','utf8');
const model = fs.readFileSync('src/cfo-model.ts','utf8');
const backend = fs.readFileSync('backend/cfo.ts','utf8');
const index = fs.readFileSync('backend/index.ts','utf8');
const css = fs.readFileSync('src/index.css','utf8');

const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(app.includes('ZEVANORY CFO'), 'missing_cfo_navigation');
check(app.includes('CfoWorkspace'), 'missing_cfo_workspace_mount');
check(index.includes("slug: 'zevanory-cfo'"), 'missing_cfo_product_catalog');
check(index.includes('cfoWorkspace'), 'missing_cfo_bootstrap');
check(backend.includes('FAIL_CLOSED'), 'missing_fail_closed');
check(backend.includes("autonomousMutations: false"), 'autonomous_mutations_not_blocked');
check(backend.includes('cfo_ready_requires_evidence'), 'adapter_ready_without_evidence_guard');
check(model.includes("schema: 'zevanory-cfo-workspace/v1'"), 'missing_schema_contract');
check(model.includes("CfoActionState"), 'missing_action_state_contract');
check(workspace.includes('O CFO não cria dados financeiros fictícios'), 'missing_no_fake_data_empty_state');
check(workspace.includes('EXECUÇÃO EXTERNA BLOQUEADA'), 'missing_external_execution_guard');
check(css.includes('.cfoWorkspace'), 'missing_cfo_styles');
check(index.includes('if (product.salesEnabled && (blockers.length > 0 || !certification.ready))'), 'regression_sale_gate');
check(app.includes("className='pillarGrid'") && app.includes('openCertification(product)'), 'regression_zees_governance_navigation');

if (failures.length) {
  console.error('ZEVANORY_CFO_AUDIT=FAIL', failures.join(','));
  process.exit(1);
}
console.log('ZEVANORY_CFO_AUDIT=PASS');
