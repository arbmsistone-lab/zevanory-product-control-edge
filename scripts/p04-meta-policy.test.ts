import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readP04Certificate, validateP04Certificate, verifyP04RenderedReceipt, P04_CERTIFIER_URL, P04_RECEIPT_URL } from '../cf-worker/p04-meta-policy.ts';
const now = Date.parse('2026-11-03T15:00:00Z');
const sha = (s: Uint8Array | string) => createHash('sha256').update(s).digest('hex');
const ids = ['legibilidade','contraste','corte','preco_cta_pixels','alegacoes','ortografia','marca'];
const cert = {protocol:'p04-certifier-v1',status:'certified',revoked:false,id:'p04-valid-certificate-01',evaluatorVersion:'p04-v1',evaluatorSha256:sha('v1'),rubricSha256:sha('rubric'),holdoutSha256:sha('holdout'),issuedAt:'2026-11-03T13:00:00Z',expiresAt:'2026-11-17T13:00:00Z',holdoutIndependent:true,pixelInspected:true,criticalRecall:1,criticalFalseNegatives:0,kappaOverall:.83,categories:ids.map(category=>({category,n:20,kappa:.72}))};
assert.equal(validateP04Certificate(cert, now),true);
for(const bad of [{revoked:true},{expiresAt:'2026-11-03T14:00:00Z'},{status:'draft'},{evaluatorVersion:'v1'},{holdoutIndependent:false},{pixelInspected:false},{criticalFalseNegatives:1},{criticalRecall:.99},{kappaOverall:.79},{categories:ids.slice(1).map(category=>({category,n:20,kappa:.72}))},{categories:ids.map(category=>({category,n:19,kappa:.72}))}])assert.equal(validateP04Certificate({...cert,...bad},now),false,JSON.stringify(bad));
assert.equal(await readP04Certificate({}),null);
for (const mode of ['throw','500','invalid']){
 const env={P04_CERTIFIER_SERVICE:{async fetch(){if(mode==='throw')throw Error('down');if(mode==='500')return new Response('',{status:500});return Response.json({status:'draft'})}}};
 assert.equal(await readP04Certificate(env,now),null,mode);
}
const image = new Uint8Array([255,216,255,224,0,1,66]);
const imageHash = sha(image), caption='ZEVANORY | Conteúdo educativo sem promessas', captionSha=sha(caption);
const uuid = 'a1a1a1a1-aaaa-4a4a-8a8a-abcdefabcdef';
const item={imageUrl:'https://controle.zevanory.api.br/api/commercial/creative/assets/'+uuid+'.jpg',detail:caption,p04ReceiptId:'receipt-valid-12345'};
const receipt={status:'approved',revoked:false,certificateId:cert.id,evaluatorVersion:cert.evaluatorVersion,pixelInspected:true,criticalPassed:true,mediaSha256:imageHash,captionSha256:captionSha};
let calls=0;
const env={P04_CERTIFIER_SERVICE:{async fetch(u: string){calls++;if(u===P04_CERTIFIER_URL)return Response.json(cert);if(u===P04_RECEIPT_URL+item.p04ReceiptId)return Response.json(receipt);throw Error('url');}}, T2_CREATIVE_ASSETS:{async get(k: string){assert.equal(k,'t2-creative/v1/'+uuid);return image.buffer;}}};
assert.equal((await verifyP04RenderedReceipt(env,item,cert)).ok,true);
assert.equal((await verifyP04RenderedReceipt(env,{...item,detail:caption+'!' },cert)).ok,false);
assert.equal((await verifyP04RenderedReceipt(env,{...item,p04ReceiptId:''},cert)).ok,false);
assert.equal((await verifyP04RenderedReceipt({...env,T2_CREATIVE_ASSETS:{async get(){return new Uint8Array([42]).buffer;}}},item,cert)).ok,false);
assert.ok(calls >= 1);
console.log(JSON.stringify({p04_gate:'PASS',cases:17,reason:'fail_closed_and_rendered_hash_checked'}));
