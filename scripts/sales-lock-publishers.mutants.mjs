// Mutantes da trava de vendas nos publicadores (cf-worker/sales-lock.ts + cf-worker/worker.ts). Cada mutante troca
// âncoras exatas (1 ocorrência cada) numa cópia descartável, roda scripts/sales-lock-publishers.test.ts e só conta
// KILLED se a suíte falhar com AssertionError. Sobrevivente ou âncora ausente => exit 1.
// Uso: node scripts/sales-lock-publishers.mutants.mjs   (sem rede, sem segredos)
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const LOCK = 'cf-worker/sales-lock.ts', WRK = 'cf-worker/worker.ts';
const COPY = ['cf-worker', 'src', 'backend', 'scripts/sales-lock-publishers.test.ts', 'package.json', 'tsconfig.json'];
const M = [
  ['SL01_publisher_gate_removed', [[WRK, 'const held = salesOpen ? [] : approved', 'const held = true ? [] : approved']]],
  ['SL02_held_items_still_published', [[WRK, 'const items = approved.filter((item: any) => !heldIds.has(item.id));', 'const items = approved;']]],
  ['SL03_lock_read_error_opens', [[LOCK, '  } catch {\n    return false;\n  }\n}', '  } catch {\n    return true;\n  }\n}']]],
  ['SL04_http_status_ignored', [[LOCK, 'if (!response || !response.ok) return false;', 'if (!response) return false;']]],
  ['SL05_open_truthy_not_strict', [[LOCK, 'return body?.open === true;', 'return Boolean(body?.open);']]],
  ['SL06_missing_binding_opens', [[LOCK, "if (!core || typeof core.fetch !== 'function') return false;", "if (!core || typeof core.fetch !== 'function') return true;"]]],
  ['SL07_price_detector_removed', [[LOCK, "if (PRICE_RE.test(s)) out.push('price');", '']]],
  ['SL08_checkout_detector_removed', [[LOCK, "if (CHECKOUT_LINK_RE.test(s)) out.push('checkout_link');", '']]],
  ['SL09_cta_detector_removed', [[LOCK, "if (PURCHASE_CTA_RE.test(s)) out.push('purchase_cta');", '']]],
  ['SL10_link_field_not_inspected', [[LOCK, 'item?.imageUrl, item?.link, item?.url', 'item?.imageUrl, item?.url']]],
  ['SL11_alert_every_tick', [[LOCK, '  if (alertedDays.has(day)) return { alerted: false, day };\n', ''], [LOCK, '    if (kv?.get && await kv.get(key)) { alertedDays.add(day); return { alerted: false, day }; }\n', '']]],
  ['SL12_alert_never_sent', [[LOCK, '  try { await alert(summary); } catch {}', '']]],
  ['SL13_caption_requires_price_when_closed', [[WRK, "...(open ? ['R$ ' + String(priceFact?.catalog?.price || '') + ',00'] : []),", "'R$ ' + String(priceFact?.catalog?.price || '') + ',00',"]]],
  ['SL14_caption_forbid_removed', [[WRK, "    if (violations.length) throw new Error('t2_caption_sales_closed_' + violations.join('_'));\n", '']]],
  ['SL15_compose_caption_keeps_price', [[WRK, "salesOpen ? t2SupportFact(slug, 'preço') : Promise.resolve(null)]);", "t2SupportFact(slug, 'preço')]);"], [WRK, "(hook ? hook + '\\n\\n' : '') + String(contentFact.answer).trim() + '\\n\\n' + (salesOpen && priceFact ?", "(hook ? hook + '\\n\\n' : '') + String(contentFact.answer).trim() + '\\n\\n' + (priceFact ?"]]],
  ['SL16_factory_caption_keeps_price', [[WRK, "      salesOpen ? t2SupportFact(slug, 'preço') : Promise.resolve(null),", "      t2SupportFact(slug, 'preço'),"], [WRK, "    const caption = String(contentFact.answer).trim() + '\\n\\n' + (salesOpen && priceFact ?", "    const caption = String(contentFact.answer).trim() + '\\n\\n' + (priceFact ?"]]],
  ['SL17_publisher_no_lock_read', [[WRK, '  const salesOpen = await readCoreSalesOpen(env);\n  const listed = await t2StoreCall(env, { op: \'list\'', '  const salesOpen = true;\n  const listed = await t2StoreCall(env, { op: \'list\'']]],
];

const tsx = existsSync(join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')) ? [process.execPath, join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')] : ['tsx'];
function stage() {
  const d = mkdtempSync(join(ROOT, '.tmp-sl-mut-'));
  for (const rel of COPY) cpSync(join(ROOT, rel), join(d, rel), { recursive: true });
  return d;
}
function run(d) {
  const r = spawnSync(tsx[0], [...tsx.slice(1), 'scripts/sales-lock-publishers.test.ts'], { cwd: d, encoding: 'utf8', timeout: 180_000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const base = stage();
const b = run(base);
rmSync(base, { recursive: true, force: true });
const baseOk = b.code === 0 && /"sales_lock_publishers":"PASS","cases":18,/.test(b.out);
console.log(JSON.stringify({ mutant_id: 'BASELINE', ok: baseOk }));
if (!baseOk) { console.log(b.out.slice(-2000)); process.exit(2); }
const results = [];
for (const [id, edits] of M) {
  const d = stage();
  let verdict = null, reason = '';
  for (const [file, oldS, newS] of edits) {
    const f = join(d, file);
    const text = readFileSync(f, 'utf8');
    const count = text.split(oldS).length - 1;
    if (count !== 1) { verdict = 'INCONCLUSIVE'; reason = file + ' anchor_count=' + count; break; }
    writeFileSync(f, text.replace(oldS, newS));
  }
  if (!verdict) {
    const r = run(d);
    const assertion = /AssertionError/.test(r.out);
    verdict = r.code !== 0 && assertion ? 'KILLED' : 'SURVIVED';
    reason = r.code === 0 ? 'suite_passed' : (assertion ? (r.out.match(/AssertionError[^\n]*/) || [''])[0].slice(0, 160) : 'non_assertion_failure');
  }
  rmSync(d, { recursive: true, force: true });
  results.push({ id, verdict });
  console.log(JSON.stringify({ mutant_id: id, verdict, reason }));
}
const killed = results.filter(r => r.verdict === 'KILLED').length;
const other = results.filter(r => r.verdict !== 'KILLED').map(r => r.id);
console.log(JSON.stringify({ mutants: results.length, KILLED: killed, other }));
process.exit(other.length ? 1 : 0);
