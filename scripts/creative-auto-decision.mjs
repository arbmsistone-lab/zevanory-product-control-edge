// R109 / P04: OFFLINE compliance review only. No credentials, network, panel or Meta calls.
// This tool cannot approve/reject/change a record or issue a certificate.
// Its output is never authority to publish; P04 independent attestation and owner act remain required.
import { readFile } from 'node:fs/promises';

const forbidden = [/gr[aá]tis/i,/garantid[oa]s? (de )?(lucro|resultado|vendas)/i,/ganhe \d|renda extra/i,/antes e depois/i,/\d+\s*%\s*(off|de desconto)/i,/\b(desconto|promo[cç][aã]o|cupom)\b/i,/[uú]ltimas vagas|s[oó] hoje|corra/i];
const validPrice = (p) => typeof p === 'number' && Number.isSafeInteger(p) && p > 0;
export function validateTableC(tableC) {
  if (!tableC || tableC.schema !== 'zevanory-table-c/v1' ||
      tableC.ownerApproved !== true || !Array.isArray(tableC.products) ||
      !tableC.products.length) throw new Error('TABLE_C_NOT_VERIFIED_FAIL_CLOSED');
  const slugs = new Set();
  for (const p of tableC.products) {
    if (!p || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(p.slug || '')) ||
        !String(p.name || '').trim() || !validPrice(p.price) ||
        p.pageUrl !== 'https://vendas.zevanory.api.br/' + p.slug ||
        slugs.has(p.slug)) throw new Error('TABLE_C_ENTRY_INVALID_FAIL_CLOSED');
    slugs.add(p.slug);
  }
  // ownerApproved is an untrusted assertion in local data, NOT an independent proof.
  // No result from this tool may be interpreted as an actual P04 certificate.
  return tableC;
}

export function decide(item, tableC) {
  validateTableC(tableC);
  const text = String(item?.title || '') + '\n' + String(item?.detail || '');
  const reasons = [];
  const matches = tableC.products.filter(p => text.toLocaleLowerCase('pt-BR').includes(p.name.toLocaleLowerCase('pt-BR')));
  if (matches.length !== 1) reasons.push('product_ambiguous_or_missing');
  const product = matches.length === 1 ? matches[0] : null;
  if (product) {
    const amounts = [...text.matchAll(/R\$\s*(\d{1,5})(?:,(\d{2}))?/g)]
      .map(m => Number(m[1]) * 100 + Number(m[2] || '00'));
    if (!amounts.length || amounts.some(v => v !== product.price * 100))
      reasons.push('price_differs_from_owner_table_c');
    if (!text.includes(product.pageUrl)) reasons.push('canonical_link_missing');
  }
  for (const pattern of forbidden) if (pattern.test(text)) reasons.push('prohibited_claim');
  if (/garantia/i.test(text) && !/7 dias/i.test(text)) reasons.push('warranty_terms_unverified');
  if (String(item?.detail || '').length > 2200) reasons.push('caption_too_long');
  // The true P04 certifier is independent. An item field/receipt is never self-certification.
  reasons.push('independent_p04_pixel_certificate_required');
  reasons.push('owner_explicit_decision_required');
  return { disposition: reasons.length > 2 ? 'BLOCKED_REVIEW' : 'MANUAL_REVIEW_REQUIRED',
    reasons: [...new Set(reasons)], product: product?.slug || null, writes: 0, publishable: false };
}

export function assessBatch(items, tableC) {
  validateTableC(tableC);
  if (!Array.isArray(items) || items.length > 1000) throw new Error('CANDIDATES_INVALID_FAIL_CLOSED');
  return {schema:'r109-p04-offline-review/v1', mode:'READ_ONLY',
    authority:'NONE', p04Gate:'NOT_CERTIFIED_BY_THIS_TOOL',
    decisions:items.map((item,i)=>({index:i,...decide(item,tableC)}))};
}

async function main() {
  if (process.argv.length !== 4) throw new Error('USAGE: node scripts/creative-auto-decision.mjs TABLE_C_LOCAL_JSON CANDIDATES_LOCAL_JSON');
  const [tableC, items] = await Promise.all(process.argv.slice(2).map(async f => JSON.parse(await readFile(f,'utf8'))));
  const out = assessBatch(items,tableC);
  console.log(JSON.stringify(out));
  // This tool NEVER authorizes a publication. Nonzero on candidate policy defects.
  if (out.decisions.some(x=>x.disposition==='BLOCKED_REVIEW')) process.exitCode = 2;
}
const direct = process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href;
if (direct) main().catch(e=>{console.error('R109_FAIL_CLOSED:',String(e?.message||e));process.exitCode=1;});
