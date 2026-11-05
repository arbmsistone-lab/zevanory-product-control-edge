import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, assessBatch, validateTableC } from '../scripts/creative-auto-decision.mjs';
import { readFileSync } from 'node:fs';

const tableC={schema:'zevanory-table-c/v1',ownerApproved:true,products:[
  {slug:'ia-na-pratica',name:'IA na Prática',price:97,pageUrl:'https://vendas.zevanory.api.br/ia-na-pratica'},
  {slug:'lucro-e-caixa',name:'Lucro & Caixa',price:97,pageUrl:'https://vendas.zevanory.api.br/lucro-e-caixa'}
]};
test('R109 cannot authorize even perfect-looking text without independent P04 and owner',()=>{
 const d=decide({title:'IA na Prática',detail:'IA na Prática R$ 97,00 https://vendas.zevanory.api.br/ia-na-pratica'},tableC);
 assert.equal(d.disposition,'MANUAL_REVIEW_REQUIRED');
 assert.equal(d.publishable,false);assert.equal(d.writes,0);
 assert.ok(d.reasons.includes('owner_explicit_decision_required'));
 assert.ok(d.reasons.includes('independent_p04_pixel_certificate_required'));
});
test('wrong legacy price and claims fail closed',()=>{
 const d=decide({title:'IA na Prática',detail:'IA na Prática R$ 197,00. Só hoje, grátis!'},tableC);
 assert.equal(d.disposition,'BLOCKED_REVIEW');
 assert.ok(d.reasons.includes('price_differs_from_owner_table_c'));
 assert.ok(d.reasons.includes('prohibited_claim'));
});
test('all prices are from supplied owner table C, no magic exemptions',()=>{
 const d=decide({title:'Lucro & Caixa',detail:'Lucro & Caixa R$ 641 https://vendas.zevanory.api.br/lucro-e-caixa'},tableC);
 assert.equal(d.disposition,'BLOCKED_REVIEW');
});
test('table C must be explicitly supplied and structurally valid',()=>{
 assert.throws(()=>validateTableC({products:tableC.products}),/FAIL_CLOSED/);
 assert.throws(()=>validateTableC({...tableC,products:[{...tableC.products[0],price:0}]}),/FAIL_CLOSED/);
 assert.throws(()=>assessBatch([{}],null),/FAIL_CLOSED/);
});
test('no credentials, network or mutation paths in offline validator',()=>{
 const source=readFileSync(new URL('../scripts/creative-auto-decision.mjs',import.meta.url),'utf8');
 for(const forbidden of ['ADMIN_PIN','ADMIN_PASSPHRASE','sessionToken','/api/commercial/approval','/api/pin/login','fetch(','https://graph.facebook.com','method: \'POST\''])
   assert.equal(source.includes(forbidden),false,'forbidden runtime path: '+forbidden);
});
