import assert from 'node:assert/strict';
import fs from 'node:fs';
import {db} from '../backend/platform.ts';
import {handler,loadGlobalTrust} from '../backend/index.ts';
let writes=0;
const old={...db};
(db as any).list=async()=>({items:[]});
for(const name of ['add','update','delete']) (db as any)[name]=async()=>{writes++;throw Error('forbidden_write')};
const nativeFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('unexpected_network')};
try {
 const diagnostic=await handler(new Request('https://local.test/api/_auth_diagnostic'));
 assert.equal(diagnostic.status,200);assert.equal(writes,0);assert.equal((await diagnostic.json()).stage,'read_only');
 const routes=[...fs.readFileSync('backend/index.ts','utf8').matchAll(/'POST (\/api\/[^']+)':/g)].map(m=>m[1]).filter(p=>!['/api/pin/login','/api/pin/logout','/api/commercial/adapter/ingest'].includes(p));
 for(const path of routes){const r=await handler(new Request('https://local.test'+path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}));assert.equal(r.status,401,path)}
 assert.equal(writes,0);
 const snapshot=JSON.parse(fs.readFileSync('audit/pr98-final/core-snapshot.json','utf8')),decision=JSON.parse(fs.readFileSync('audit/pr98-final/core-decision.json','utf8'));
 const result=await loadGlobalTrust(Promise.resolve([snapshot,decision]));assert.equal(result.state,'BLOCKED');assert.equal(result.sha,snapshot.release_sha);assert.equal(result.evidenceRoot,snapshot.zees16.decision_hash);
 const now=new Date().toISOString();
 const s={...snapshot,generated_at:now,zees16:{counts:{proven:16,partial:0,blocked:0},decision_hash:'b'.repeat(64)},zea10:{counts:{proven:10,partial:0,blocked:0,unknown:0}}};
 const d={...decision,generated_at:now,decision:'ALLOW',eligible_for_critical_promotion:true,blockers:[],zees16_decision_hash:'b'.repeat(64)};
 assert.equal((await loadGlobalTrust(Promise.resolve([s,d]))).state,'GREEN');
 for(const pair of [[s,{...d,release_sha:'c'.repeat(40)}],[s,{...d,zees16_decision_hash:'c'.repeat(64)}],[{...s,generated_at:'2020-01-01'},d],[s,{...d,decision:'DENY'}]])assert.equal((await loadGlobalTrust(Promise.resolve(pair as [any,any]))).state,'BLOCKED');
 console.log('BACKEND_CONTRACT=PASS PUBLIC_DIAGNOSTIC_WRITES=0 UNAUTHENTICATED_ROUTES='+routes.length+' LIVE_CORE_PROJECTION=BLOCKED');
}finally{Object.assign(db,old);globalThis.fetch=nativeFetch}
