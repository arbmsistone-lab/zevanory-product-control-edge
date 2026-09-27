import fs from 'node:fs';

const base='https://controle.zevanory.api.br';
const render='https://zevanory-product-control-edge.onrender.com';
const expected=process.env.EXPECTED_DEPLOY_SHA || '';
const evidence={schema:'zevanory.production-readback.v1',at:new Date().toISOString(),observer:'github-actions',expectedDeploySha:expected,checks:[]};
const record=(name,ok,detail={})=>{evidence.checks.push({name,ok,...detail}); if(!ok) process.exitCode=1;};

async function fetchTimed(url,opts={}){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
  try { const r=await fetch(url,{...opts,signal:controller.signal,headers:{'user-agent':'ZEVANORY-Production-Readback/1.0',...(opts.headers||{})}}); return r; }
  finally { clearTimeout(timer); }
}
async function checkHealth(origin,label){
  try { const r=await fetchTimed(origin+'/portable-health'); const text=await r.text(); let body=null; try{body=JSON.parse(text)}catch{}
    record(label,r.ok&&!!body&&body.ok===true,{status:r.status,contentType:r.headers.get('content-type'),body});
  } catch(e){ record(label,false,{error:String(e)}); }
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
