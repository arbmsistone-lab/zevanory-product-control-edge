import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { CREATIVE_FACTORY_PURPOSE, TICK_SECRET_NAME } from '../cf-worker/commercial-hmac.ts';
import { P04_CERTIFIER_URL, P04_RECEIPT_URL } from '../cf-worker/p04-meta-policy.ts';
import worker from '../cf-worker/worker.ts';

const hash = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');
const SECRET = 'nc006-test-secret-not-production-1234567890';
const APP_SECRET = 'nc006-meta-app-secret-not-production';
const UUID = 'a1a1a1a1-aaaa-4a4a-8a8a-abcdefabcdef';
const CAPTION = 'ZEVANORY: informações educativas';
const IMAGE = new Uint8Array([255,216,255,224,0,1,66,22,11]);
const receiptId = 'receipt-nc006-valid-0001';
const categoryNames = ['legibilidade','contraste','corte','preco_cta_pixels','alegacoes','ortografia','marca'];
function certificate() {
 const now = Date.now();
 return {
  protocol:'p04-certifier-v1', status:'certified', revoked:false,
  id:'p04-nc006-valid-0001', evaluatorVersion:'p04-nc006-v1', evaluatorSha256:hash('eval'),
  rubricSha256:hash('rubric'), holdoutSha256:hash('holdout'),
  issuedAt:new Date(now-60000).toISOString(), expiresAt:new Date(now+86400000).toISOString(),
  holdoutIndependent:true,pixelInspected:true,criticalRecall:1,criticalFalseNegatives:0,
  kappaOverall:.85, categories:categoryNames.map(category=>({category,n:30,kappa:.76}))
 };
}
function headers() {
 const ts = String(Date.now()), nonce = 'nc006-'+crypto.randomUUID();
 const signature = createHmac('sha256', SECRET).update([CREATIVE_FACTORY_PURPOSE,ts,nonce].join('\n')).digest('hex');
 return {'x-commercial-timestamp':ts,'x-commercial-nonce':nonce,'x-commercial-signature':signature};
}
function webhook(body: unknown) {
 const raw=JSON.stringify(body);
 const sig=createHmac('sha256',APP_SECRET).update(raw).digest('hex');
 return new Request('https://controle.zevanory.api.br/api/meta/webhook',{method:'POST',
  headers:{'content-type':'application/json','x-hub-signature-256':'sha256='+sig},body:raw});
}
const testComment = {object:'instagram',entry:[{changes:[{field:'comments',value:{id:'comment-001',text:'Olá',from:{id:'outsider-001',username:'tester'}}}]}]};
function makeEnv({open=true, validCert=true, revokeAt=Number.POSITIVE_INFINITY, withCreative=true}={}) {
 const current=certificate(), receipt={status:'approved',revoked:false,certificateId:current.id,
 evaluatorVersion:current.evaluatorVersion,pixelInspected:true,criticalPassed:true,
 mediaSha256:hash(IMAGE),captionSha256:hash(CAPTION)};
 const state={certReads:0,reservations:0,kv:new Map<string,unknown>()};
 const item={id:UUID,kind:'creative',status:'approved',publishedAt:null,detail:CAPTION,
 imageUrl:'https://controle.zevanory.api.br/api/commercial/creative/assets/'+UUID+'.jpg',
 p04ReceiptId:receiptId,evidence:['catalogCaptionValidation:PASS'],title:'Teste educativo'};
 const env:Record<string,any>={
  SUPABASE_URL:'https://sb.test',SUPABASE_PUBLISHABLE_KEY:'test-key',ZPC_REPLICATION_SECRET:'test-replication',
  META_SYSTEM_TOKEN:'test-meta-system-token',META_APP_SECRET:APP_SECRET,[TICK_SECRET_NAME]:SECRET,
  CORE_WORKER:{async fetch(){return Response.json({open});}},
  T2_CREATIVE_ASSETS:{
    async get(key:string){return key==='t2-creative/v1/'+UUID ? IMAGE.buffer : state.kv.get(key)??null;},
    async put(key:string,value:any){state.kv.set(key,value)}
  },
  P04_CERTIFIER_SERVICE:{async fetch(url:string){
   if(url===P04_CERTIFIER_URL){
    state.certReads++;
    return Response.json(validCert && state.certReads<revokeAt ? current : {...current,revoked:true});
   }
   if(url===P04_RECEIPT_URL+receiptId)return Response.json(receipt);
   return Response.json({error:'missing'},{status:404});
  }},
  P06_META_RESERVATION_SERVICE:{async fetch(url:string,init:RequestInit){
   assert.equal(url,'https://zevanory.api.br/api/p06/meta/reserve');
   const b=JSON.parse(String(init.body));
   assert.equal(b.mediaSha256,hash(IMAGE));
   state.reservations++;
   return Response.json({contract:'p06-atomic-media-v1',status:'reserved',
    reservationId:'reserved-by-test-0001',mediaSha256:hash(IMAGE)});
  }}
 };
 return {env,item:withCreative?item:null,state};
}
async function run({env,item}:ReturnType<typeof makeEnv>,route:'tick'|'webhook') {
 const calls:{method:string;path:string}[]=[];
 const writes:any[]=[];
 const original=globalThis.fetch;
 globalThis.fetch=(async (url:any,init:any={})=>{
  const u=String(url instanceof Request?url.url:url);
  if(u.startsWith('https://sb.test/rest/v1/rpc/')){
   if(u.endsWith('zpc_worker_list'))return Response.json({items:item?[item]:[]});
   if(u.endsWith('zpc_worker_upsert')){writes.push(JSON.parse(String(init.body)));return Response.json({ok:true});}
   return Response.json({ok:true});
  }
  if(u.startsWith('https://graph.facebook.com/')){
    const path=u.split('?')[0];
    calls.push({method:init.method||'GET',path});
    if(path.endsWith('/media_publish'))return Response.json({id:'ig-post-100'});
    if(path.endsWith('/media'))return Response.json({id:'container-100'});
    if(path.endsWith('/container-100'))return Response.json({status_code:'FINISHED'});
    if(path.endsWith('/photos'))return Response.json({post_id:'fb-post-100'});
    return Response.json({id:'1249902628211703',name:'Test',access_token:'page-test',
      instagram_business_account:{id:'ig-business-test',username:'zevanory'}});
  }
  if(u.startsWith('https://zevanory.api.br/api/support/knowledge'))return Response.json({answered:true,answer:'Olá. Como podemos ajudar?',sources:[]});
  return new Response('unexpected: '+u,{status:599});
 }) as typeof fetch;
 const priorWarn=console.warn; console.warn=()=>{};
 try {
 const req=route==='tick'
  ?new Request('https://controle.zevanory.api.br/api/commercial/publish/tick',{method:'POST',headers:headers()})
  :webhook(testComment);
 const res=await worker.fetch(req,env);
 return {status:res.status,body:await res.text(),calls,writes};
 } finally{globalThis.fetch=original;console.warn=priorWarn;}
}
const getPosts=(x:Awaited<ReturnType<typeof run>>)=>x.calls.filter(c=>c.method==='POST');
const metrics:Record<string,string>={};
{
 const d=makeEnv({open:true});
 const r=await run(d,'tick');
 assert.equal(r.status,200,r.body);
 assert.equal(JSON.parse(r.body).published.length,1);
 assert.equal(d.state.reservations,1);
 assert.deepEqual(getPosts(r).map(x=>x.path.split('/').at(-1)),['media','media_publish','photos']);
 metrics['T3_VALID_CERT_P06_PUBLISH_ONCE']='PASS';
}
{
 const d=makeEnv({open:true,revokeAt:3});
 const r=await run(d,'tick');
 assert.equal(r.status,500,r.body);
 assert.deepEqual(getPosts(r).map(x=>x.path.split('/').at(-1)),['media'],'revoke after creation: ZERO live posts');
 assert.equal(d.state.reservations,1);
 assert.ok(r.writes.some(x=>x.p_bucket==='zpc_commercial_events' && x.p_items[0].record.title.includes('bloqueada após reserva')), 'A06 alert retained after P06 reservation');
 metrics['T3_REVOCATION_AFTER_MEDIA_AND_ALERT']='PASS';
}
{
 for(const params of [{open:false,validCert:true},{open:true,validCert:false}]){
  const d=makeEnv({...params,withCreative:false});
  const r=await run(d,'webhook');
  assert.equal(r.status,200,r.body);
  assert.deepEqual(r.calls,[],'T4 fail-closed: zero Meta GET or POST');
 }
 metrics['T4_ZERO_META_WHEN_SALES_OR_P04_CLOSED']='PASS';
}
{
 const d=makeEnv({open:true,validCert:true,withCreative:false});
 const r=await run(d,'webhook');
 assert.equal(r.status,200,r.body);
 assert.deepEqual(getPosts(r).map(c=>c.path.split('/').at(-1)),['replies']);
 metrics['T4_VALID_OPEN_REPLY']='PASS';
}
{
 const d=makeEnv({open:true,validCert:true,revokeAt:2,withCreative:false});
 const r=await run(d,'webhook');
 assert.equal(r.status,200,r.body);
 assert.deepEqual(getPosts(r),[],'T4 revoke just before reply: zero Meta POST');
 metrics['T4_REVOKE_BEFORE_REPLY']='PASS';
}
console.log(JSON.stringify({nc006_t3_t4:'PASS',cases:Object.keys(metrics).length,metrics}));
