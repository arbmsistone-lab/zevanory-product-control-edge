// R111: no real secrets or network. Verify Siteverify gate BEFORE any limiter or password processing.
import assert from 'node:assert/strict';
import worker from '../cf-worker/worker.ts';
import { TURNSTILE_ACTION, TURNSTILE_HOSTNAME, TURNSTILE_VERIFY_URL, verifyTurnstileLogin } from '../cf-worker/admin-turnstile.ts';
const uri='https://controle.zevanory.api.br/api/pin/login';
const config={TURNSTILE_ENFORCED:'true',TURNSTILE_SITE_KEY:'1x00000000000000000000AA',TURNSTILE_SECRET:'test-only-secret-no-real-credential'};
const login=(body:any)=>new Request(uri,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'192.0.2.50'},body:JSON.stringify(body)});
let siteverify=0;
let limiterCalls=0;
const valid = async (url:any,init:any):Promise<Response>=>{
  siteverify++;
  assert.equal(String(url),TURNSTILE_VERIFY_URL);
  assert.equal(init.method,'POST');
  assert.ok(String(init.body).includes('secret='));
  assert.ok(String(init.body).includes('response='));
  return Response.json({success:true,hostname:TURNSTILE_HOSTNAME,action:TURNSTILE_ACTION});
};
{
 const denied=await verifyTurnstileLogin(login({pin:'a long enough phrase'}),config,valid as typeof fetch);
 assert.equal(denied.status,403);assert.equal(siteverify,0);
}
{
 const x=await verifyTurnstileLogin(login({turnstileToken:'proof-valid-1234567'}),config,valid as typeof fetch);
 assert.equal(x.ok,true);assert.equal(siteverify,1);
}
{
 const failures=[{success:false,hostname:TURNSTILE_HOSTNAME,action:TURNSTILE_ACTION},
                 {success:true,hostname:'evil.test',action:TURNSTILE_ACTION},
                 {success:true,hostname:TURNSTILE_HOSTNAME,action:'another-action'}];
 for(const payload of failures){
  const r=await verifyTurnstileLogin(login({turnstileToken:'proof-12345'}),config,async()=>Response.json(payload));
  assert.equal(r.status,403);
 }
}
{
 const upstream=await verifyTurnstileLogin(login({turnstileToken:'proof-12345'}),config,async()=>{throw Error('offline');});
 assert.equal(upstream.status,503);
 const noSecret=await verifyTurnstileLogin(login({turnstileToken:'proof-12345'}),{...config,TURNSTILE_SECRET:''},valid as typeof fetch);
 assert.equal(noSecret.status,503);
}
{
 // Mandatory policy integration: a request lacking a token cannot touch the shared limiter.
 const env:any={...config,ADMIN_AUTH_MODE:'passphrase',ADMIN_PASSPHRASE:'contract-only-auth-not-real',
  SESSION_SIGNING_KEY:'test-only-signing-key-long-enough-32',
  PIN_LIMITER:{async limit(){limiterCalls++;return {success:true}}},
  RENDER_BACKEND_URL:''};
 const missing=await worker.fetch(login({pin:'not real a sufficient phrase'}),env);
 assert.equal(missing.status,403);assert.equal(limiterCalls,0);
 // Valid token proceeds to the existing limiter and authentication, not directly to a session.
 const saved=globalThis.fetch;
 globalThis.fetch=(async (url:any,init:any)=>valid(url,init)) as typeof fetch;
 try{
   const passed=await worker.fetch(login({pin:'still not the real passphrase',turnstileToken:'proof-valid-12345'}),env);
   assert.ok([401,429,503].includes(passed.status),'token acceptance must not grant login');
   assert.ok(limiterCalls>0,'valid challenge must continue into existing limiter');
   assert.equal(siteverify,2);
 }finally{globalThis.fetch=saved;}
}
console.log('R111_TURNSTILE_GATE_PASS missing_403=true before_limiter=true valid_proceeds=true upstream_fail_closed=true host_action_checked=true');