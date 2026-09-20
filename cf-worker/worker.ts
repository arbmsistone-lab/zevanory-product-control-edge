import { handler } from './backend-index.ts';
import { portableHealth, setWorkerEnv } from './platform-worker.ts';

const BACKEND_SOURCE_SHA = 'b2a0c46488f0ea9ae14f536b6beeb71afefe346e';

const CERTIFIER_HTML = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>ZEVANORY ZEES-16</title>
<style>
*{box-sizing:border-box}body{margin:0;height:100vh;overflow:hidden;background:#06101b;color:#edf5ff;font:14px system-ui,sans-serif}main{height:100vh;overflow:hidden;max-width:980px;margin:0 auto;padding:18px 24px}
.card{background:#0b1725;border:1px solid #20364f;border-radius:16px;padding:18px;margin:12px 0}h1{margin:0 0 6px;font-size:28px}p{color:#93a8bf}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}input,select,button{border:1px solid #2b4665;border-radius:10px;background:#081321;color:#eef6ff;padding:11px 12px}
input,select{flex:1;min-width:220px}button{cursor:pointer;font-weight:800}button.primary{background:#d6e9ff;color:#07111c;border-color:#d6e9ff}
button:disabled{opacity:.45;cursor:not-allowed}.pill{display:inline-block;border-radius:999px;padding:5px 8px;background:#10263d;color:#a9c8e8;font-size:11px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.metric{border:1px solid #1d334b;border-radius:10px;padding:10px;background:#081421}
.metric b,.metric small{display:block}.metric b{font-size:20px}.metric small{color:#7f96ad;margin-top:3px}
pre{white-space:pre-wrap;word-break:break-word;background:#050d16;border:1px solid #1a3048;padding:12px;border-radius:10px;max-height:220px;overflow:auto}
.seals{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;margin:12px 0}.seal{display:grid;place-items:center;height:34px;border:1px solid #30445a;border-radius:8px;background:#101a28;color:#8fa4bd;font-size:10px;font-weight:900}.seal.proved{border-color:#2f7d5d;background:#0e2c24;color:#8ff0ca}.seal.partial{border-color:#7a622b;background:#2c2411;color:#f0cd75}.seal.blocked{border-color:#734039;background:#2d1717;color:#f0a4a4}.seal.na,.seal.external{border-color:#35465b;background:#162131;color:#9badc2}.legend{display:flex;gap:10px;flex-wrap:wrap;color:#8da2b9;font-size:11px}.legend .proved{color:#8ff0ca}.legend .partial{color:#f0cd75}.legend .blocked{color:#f0a4a4}
.ok{color:#83dfbd}.warn{color:#efc77d}.bad{color:#ef9a9a}@media(max-width:720px){.grid{grid-template-columns:1fr 1fr}.seals{grid-template-columns:repeat(4,minmax(0,1fr))}}
</style></head>
<body><main>
<div class="card"><span class="pill">CLOUDFLARE DIRECT · ZEES-16</span><h1>ZEVANORY PRODUCT CONTROL</h1><p>Console independente de certificação. Não depende de Render, Vercel, Netlify ou Railway para executar P01–P16.</p></div>
<div class="card" id="loginCard"><h2>Acesso administrativo</h2><div class="row"><input id="pin" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" placeholder="PIN de 4 dígitos"><button class="primary" id="login">Entrar</button></div><p id="auth"></p></div>
<div class="card" id="execCard" hidden><h2>Executor de certificação</h2><div class="row"><select id="target"></select><button class="primary" id="run">Executar certificação</button><button id="reload">Atualizar</button></div>
<div class="grid" id="summary"></div><div id="sealTitle"></div><div class="seals" id="seals"></div><div class="legend"><span class="proved">■ PROVADO</span><span class="partial">■ PARCIAL</span><span class="blocked">■ BLOQUEADO</span><span>■ N/A</span></div><p id="state"></p><pre id="output">Aguardando execução.</pre></div>
</main><script>
let sessionToken='';
const qs=(id)=>document.getElementById(id);
const API_BASE=location.pathname.startsWith('/control')?'/control':'';
async function api(path,body){const r=await fetch(API_BASE+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||j.message||('HTTP '+r.status));return j}
let bootstrapData=null;
async function load(){const data=await api('/api/admin/bootstrap?runtime=cloudflare',{sessionToken});bootstrapData=data;const select=qs('target');select.innerHTML='';for(const t of data.certificationTargets||[]){const o=document.createElement('option');o.value=t.id;o.textContent=t.name+' · '+t.certification.summary.proved+'/'+t.certification.summary.applicable;select.appendChild(o)}renderSummary(data.summary);renderSeals();return data}
function renderSummary(s){qs('summary').innerHTML=[['Produtos',s.total],['Certificados',s.certified],['Em certificação',s.inCertification],['ZEES bloqueados',s.zeesBlocked]].map(([a,b])=>'<div class="metric"><b>'+b+'</b><small>'+a+'</small></div>').join('')}
function renderSeals(){const id=qs('target').value;const t=(bootstrapData?.certificationTargets||[]).find(x=>x.id===id);if(!t){qs('seals').innerHTML='';qs('sealTitle').innerHTML='';return}qs('sealTitle').innerHTML='<p><b>'+t.name+'</b> · '+t.certification.summary.proved+'/'+t.certification.summary.applicable+' aplicáveis</p>';qs('seals').innerHTML=(t.certification.pillars||[]).map(p=>'<span class="seal '+p.status+'" title="'+p.id+' · '+p.name+' · '+p.status+'">'+p.id+'</span>').join('')}
qs('login').onclick=async()=>{const pin=qs('pin').value.trim();if(!/^\d{4}$/.test(pin)){qs('auth').textContent='Informe 4 dígitos.';return}qs('login').disabled=true;try{const j=await api('/api/pin/login?runtime=cloudflare',{pin});sessionToken=j.sessionToken;qs('pin').value='';qs('auth').innerHTML='<span class="ok">PIN OK · sessão criada.</span>';qs('execCard').hidden=false;await load()}catch(e){qs('auth').innerHTML='<span class="bad">'+e.message+'</span>'}finally{qs('login').disabled=false}}
qs('target').onchange=renderSeals;
qs('reload').onclick=async()=>{try{await load();qs('state').textContent='Atualizado.'}catch(e){qs('state').textContent=e.message}}
qs('run').onclick=async()=>{qs('run').disabled=true;qs('state').innerHTML='<span class="warn">Executando P01–P16...</span>';try{const j=await api('/api/certification/run?runtime=cloudflare',{sessionToken,targetId:qs('target').value});qs('output').textContent=JSON.stringify(j,null,2);qs('state').innerHTML=j.certification?.ready?'<span class="ok">CERTIFICADO integralmente.</span>':'<span class="warn">Execução concluída; gate permanece fail-closed.</span>';await load()}catch(e){qs('state').innerHTML='<span class="bad">'+e.message+'</span>'}finally{qs('run').disabled=false}}
</script></body></html>`;

export default {
  async fetch(request: Request, env: Record<string, unknown>) {
    setWorkerEnv(env);
    const url = new URL(request.url);
    const normalizedPath = url.pathname === '/control' ? '/' : url.pathname.startsWith('/control/') ? url.pathname.slice('/control'.length) : url.pathname;
    const normalizedUrl = new URL(request.url);
    normalizedUrl.pathname = normalizedPath;
    const normalizedRequest = new Request(normalizedUrl.toString(), request);

    if (normalizedPath === '/certifier') {
      return new Response(CERTIFIER_HTML, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'x-robots-tag': 'noindex, nofollow',
          'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        },
      });
    }

    if (normalizedPath === '/portable-health') {
      const health = await portableHealth();
      return Response.json({ ...health, runtime: 'cloudflare-worker', backendSourceSha: BACKEND_SOURCE_SHA, workerCommit: String(env.WORKER_COMMIT || 'untracked') }, {
        status: health.ok ? 200 : 503,
        headers: { 'cache-control': 'no-store' },
      });
    }

    if (normalizedPath === '/runtime-proof') {
      return Response.json({ ok: true, runtime: 'cloudflare-worker', backendSourceSha: BACKEND_SOURCE_SHA, workerCommit: String(env.WORKER_COMMIT || 'untracked'), directBackend: true }, {
        headers: { 'cache-control': 'no-store' },
      });
    }

    if (normalizedPath === '/definir-pin' || normalizedPath === '/__complete-pin-migration') {
      return Response.json(
        { ok: false, error: 'migration_closed' },
        { status: 410, headers: { 'cache-control': 'no-store, max-age=0' } },
      );
    }

    if (normalizedPath.startsWith('/api/')) {
      const forceDirect = url.searchParams.get('runtime') === 'cloudflare';
      const renderBase = forceDirect ? '' : String(env.RENDER_BACKEND_URL || '').replace(/\/$/, '');
      if (renderBase) {
        try {
          const target = renderBase + normalizedPath + url.search;
          const primaryResponse = await fetch(new Request(target, normalizedRequest.clone()));
          if (primaryResponse.status < 500) return primaryResponse;
        } catch {}
      }
      return handler(normalizedRequest);
    }

    if (env.ASSETS && typeof (env.ASSETS as any).fetch === 'function') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = normalizedPath === '/' ? '/' : normalizedPath;
      const assetResponse = await (env.ASSETS as any).fetch(new Request(assetUrl.toString(), request));
      if (assetResponse.status !== 404) return assetResponse;
      return (env.ASSETS as any).fetch(new Request(new URL('/', request.url).toString(), request));
    }

    return handler(normalizedRequest);
  },
};
