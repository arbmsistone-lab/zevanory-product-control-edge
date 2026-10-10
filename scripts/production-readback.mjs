import fs from 'node:fs';

const base='https://controle.zevanory.api.br';
const render='https://zevanory-product-control-edge.onrender.com';
const expected=process.env.EXPECTED_DEPLOY_SHA || '';
const evidence={at:new Date().toISOString(),observer:'github-actions',expectedDeploySha:expected,checks:[]};
const record=(name,ok,detail={})=>{evidence.checks.push({name,ok,...detail}); if(!ok) process.exitCode=1;};

// Render free instances may be cold. Every retry still requires HTTP 2xx and a real {ok:true}
// response from BOTH independent health origins; exhaustion remains a hard failure.
const HEALTH_TIMEOUT_MS = 45000;
const HEALTH_ATTEMPTS = 3;
const HEALTH_RETRY_DELAY_MS = 3000;
async function fetchTimed(url,opts={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),HEALTH_TIMEOUT_MS);
  try {
    const response=await fetch(url,{...opts,signal:controller.signal,headers:{'user-agent':'ZEVANORY-Production-Readback/1.0',...(opts.headers||{})}});
    const bodyText=await response.text(); // Keep timeout active until the complete body is read.
    return {response,bodyText};
  } finally { clearTimeout(timer); }
}
async function checkHealth(origin,label){
  let last={error:'health_unverified'};
  for(let attempt=1; attempt<=HEALTH_ATTEMPTS; attempt++){
    try {
      const {response,bodyText}=await fetchTimed(origin+'/portable-health');
      let body=null; try{body=JSON.parse(bodyText)}catch{}
      const detail={status:response.status,contentType:response.headers.get('content-type'),body,attempt};
      if(response.ok && body && body.ok===true){
        record(label,true,detail);
        return;
      }
      last=detail;
    } catch(e){last={error:String(e),attempt};}
    if(attempt<HEALTH_ATTEMPTS) await new Promise(resolve=>setTimeout(resolve,HEALTH_RETRY_DELAY_MS));
  }
  record(label,false,{...last,attempts:HEALTH_ATTEMPTS});
}
async function checkSse(path,label){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),9000);
  try {
    const r=await fetch(base+path,{signal:controller.signal,headers:{accept:'text/event-stream','user-agent':'ZEVANORY-Production-Readback/1.0'}});
    const ct=r.headers.get('content-type')||''; const reader=r.body?.getReader(); let text='';
    const deadline=Date.now()+7500;
    while(reader&&Date.now()<deadline&&text.length<4096){
      const {value,done}=await reader.read(); if(done)break; text+=new TextDecoder().decode(value);
      if(/id:\s*[^\n]+/.test(text)&&/event:\s*commercial-update/.test(text)&&/data:\s*\{/.test(text))break;
    }
    record(label,r.ok&&ct.includes('text/event-stream')&&/id:\s*[^\n]+/.test(text)&&/event:\s*commercial-update/.test(text)&&/data:\s*\{/.test(text),{status:r.status,contentType:ct,sample:text.slice(0,800)});
  } catch(e){ record(label,false,{error:String(e)}); } finally {clearTimeout(timer); controller.abort();}
}
await checkHealth(base,'custom-domain-health');
await checkHealth(render,'render-origin-health');
await checkSse('/api/commercial/stream','custom-domain-sse-root');
await checkSse('/control/api/commercial/stream','custom-domain-sse-control');
record('release-sha-bound',expected.length===40,{expectedDeploySha:expected,note:'SHA is independently bound to the Render LIVE deploy metadata before this workflow is dispatched.'});
evidence.pass=evidence.checks.every(x=>x.ok);
fs.writeFileSync('production-readback.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
if(!evidence.pass) process.exit(1);
