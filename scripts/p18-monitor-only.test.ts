// NC-007 P18-01..04. All external network calls are replaced by mocks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createP18OnlyHandler } from '../p18-monitor/worker.ts';
import { runP18ExternalTrigger } from '../cf-worker/p18-dispatch.ts';
const source=readFileSync(new URL('../p18-monitor/worker.ts',import.meta.url),'utf8');
const config=readFileSync(new URL('../p18-monitor/wrangler.toml',import.meta.url),'utf8');
const code=[source,config].join('\n');
const forbidden=['META_SYSTEM_TOKEN','RENDER_BACKEND_URL','TELEGRAM_BOT_TOKEN','SUPABASE_URL','COMMERCIAL_ROBOT_TICK_SECRET'];
for(const x of forbidden)assert.ok(!code.includes(x),'forbidden commercial binding '+x);
assert.ok(!/from\s+['"][^'"]*\/cf-worker\/worker\.(ts|js)/.test(source),'never import commercial worker');
assert.ok(!/\bfetch\s*\(/.test(source),'handler cannot make independent outgoing fetch');
assert.ok(!/\[\[services\]\]|\[\[routes\]\]|^routes\s*=|\[assets\]/m.test(config),'no service or HTTP routes');
assert.ok(config.includes('workers_dev = false'),'no workers.dev HTTP surface');
assert.ok(config.includes('name = "zevanory-p18-monitor-only"'));
assert.ok(config.includes('crons = ["*/5 * * * *"]'));
assert.ok(config.includes('binding = "P18_STATE_KV"'));
assert.ok(!/\[\[ratelimits\]\]|\[ai\]/.test(config));
console.log('P18-01=PASS source isolation + minimal bindings');

// 288 windows, covering 24h, including 00/15/30/45 UTC minutes.
const sent: Array<{scheduledTime:number; env:Record<string,unknown>}>=[];
let metaReads=0,renderReads=0,telegramReads=0;
const env:any={P18_DISPATCH_TOKEN:'test-only',P18_STATE_KV:{async get(){return null},async put(){}}};
for(const key of ['META_SYSTEM_TOKEN','RENDER_BACKEND_URL','TELEGRAM_BOT_TOKEN']){
 Object.defineProperty(env,key,{get(){key.includes('META')?metaReads++:key.includes('RENDER')?renderReads++:telegramReads++;throw Error('commercial binding read: '+key)}});
}
const runner=(async (arg:any)=>{sent.push({scheduledTime:arg.scheduledTime,env:arg.env});return {ok:true}}) as typeof runP18ExternalTrigger;
const h=createP18OnlyHandler(runner);
const pending:Promise<unknown>[]=[];
const ctx={waitUntil(p:Promise<unknown>){pending.push(p)}};
for(let i=0;i<288;i++)h.scheduled({cron:'*/5 * * * *',scheduledTime:Date.parse('2026-11-04T00:00:00Z')+i*300000},env,ctx);
await Promise.all(pending);
assert.equal(sent.length,288,'288 calls to P18, none to any other worker');
assert.equal(metaReads+renderReads+telegramReads,0,'commercial tokens never accessed');
assert.ok(sent.every(x=>Object.keys(x.env).sort().join(',')==='P18_DISPATCH_TOKEN,T2_CREATIVE_ASSETS'));
assert.ok(sent.some(x=>new Date(x.scheduledTime).getUTCMinutes()===0));
assert.ok(sent.some(x=>new Date(x.scheduledTime).getUTCMinutes()===15));
assert.ok(sent.some(x=>new Date(x.scheduledTime).getUTCMinutes()===30));
assert.ok(sent.some(x=>new Date(x.scheduledTime).getUTCMinutes()===45));
console.log('P18-02=PASS 24h 288 ticks zero commercial calls');

// Run ACTUAL P18 orchestrator with synthetic GitHub/heartbeat responses; zero real requests.
async function runCase(status:number){
 const calls:{url:string;method:string}[]=[],writes:string[]=[];
 const kv={async get(){return null},async put(k:string){writes.push(k)}};
 const env2={P18_DISPATCH_TOKEN:'TEST_P18_DISPATCH_TOKEN_DO_NOT_LOG',T2_CREATIVE_ASSETS:kv};
 const res=await runP18ExternalTrigger({
  env:env2,scheduledTime:Date.parse('2026-11-04T12:00:00Z'),now:()=>Date.parse('2026-11-04T12:00:05Z'),
  fetchImpl:async (url,init={})=>{
   const method=String(init.method||'GET');calls.push({url,method});
   if(url.includes('api.github.com'))return new Response('',{status});
   if(url.includes('raw.githubusercontent.com'))return new Response('',{status:404});
   throw Error('unexpected network '+url);
  },
  log:line=>{assert.ok(!line.includes('TEST_P18_DISPATCH_TOKEN_DO_NOT_LOG'))}
 });
 assert.equal(calls.length,2,'two subrequests only');
 assert.equal(res.fetch_subrequests,2,'bounded P18 subrequests');
 assert.ok(res.alerts>0,'unhealthy P18 must generate alert');
 assert.ok(writes.some(k=>k.startsWith('zpc-alert:v1:')),'owner alert persisted');
 assert.ok(writes.every(k=>k==='p18-ext:v1:state'||k.startsWith('zpc-alert:v1:')));
 assert.ok(calls.some(x=>x.method==='POST'&&x.url.includes('api.github.com')));
 assert.ok(calls.some(x=>x.method==='GET'&&x.url.includes('raw.githubusercontent.com')));
 return res.dispatch.outcome;
}
const modes:[[number,string],[number,string],[number,string],[number,string]]=[[401,'auth'],[403,'forbidden'],[429,'rate_limited'],[500,'unavailable']];
for(const [status,expected] of modes)assert.equal(await runCase(status),expected,'HTTP '+status);
console.log('P18-03=PASS caps + KV alerts / P18-04=PASS 401,403,429,500 and stale heartbeat');
console.log('NC007_P18_MONITOR_ONLY=PASS tests=4 windows=288');
