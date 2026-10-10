import { guardProxiedEdgeSession, handler, setSessionRevocationStore, verifyEdgeSession } from './backend-index.ts';
import { ADS_POLICY, assessAdsReadiness } from '../src/ads-readiness.ts';
import { portableHealth, setWorkerEnv } from './platform-worker.ts';

const PAGES_ORIGIN = 'https://arbmsistone-lab.github.io/zevanory-product-control-edge';
const CANONICAL_PUBLIC_ORIGIN = 'https://controle.zevanory.api.br';
const PUBLIC_MIRROR_ORIGIN = 'https://arbmsistone-lab.github.io/zevanory-public-mirror';

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

async function commercialRobotTickSignature(secret: string, timestamp: string, nonce: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(['zevanory-commercial-robot-tick-v1', timestamp, nonce].join('\n')),
  );
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Edge snapshot of the admin bootstrap (Render adminData takes 6-10s+, more when cold).
// Session is verified at the edge first; the snapshot is shared by all valid admin sessions,
// served fresh for 60s, stale-while-revalidate up to 15min, and dropped on any mutating call.
const BOOTSTRAP_SNAPSHOT_KEY = 'zpc-admin-bootstrap-snapshot:v1';
const BOOTSTRAP_FRESH_MS = 60_000;
const BOOTSTRAP_STALE_MS = 6 * 60 * 60_000;
const BOOTSTRAP_READ_ONLY = new Set(['/api/admin/bootstrap', '/api/admin/overview', '/api/_session_verify', '/api/pin/login', '/api/pin/logout']);

async function fetchRenderBootstrap(renderBase: string, body: string) {
  const response = await fetch(renderBase + '/api/admin/bootstrap', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body,
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) return null;
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    if (!parsed || !parsed.dashboard || !parsed.commercial) return null;
  } catch { return null; }
  return text;
}

async function storeBootstrapSnapshot(store: any, text: string) {
  try {
    await store.put(BOOTSTRAP_SNAPSHOT_KEY, text, { metadata: { at: Date.now() }, expirationTtl: 6 * 3600 });
  } catch {}
}

async function edgeBootstrap(request: Request, env: Record<string, any>, ctx: any, renderBase: string): Promise<Response | null> {
  const store = env.T2_CREATIVE_ASSETS;
  if (!store?.getWithMetadata || !renderBase) return null;
  const body = await request.clone().text();
  let token = '';
  try { token = String(JSON.parse(body)?.sessionToken || ''); } catch {}
  if (!token || !(await verifyEdgeSession(token))) return null; // let the normal path answer 401
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
  try {
    const cached = await store.getWithMetadata(BOOTSTRAP_SNAPSHOT_KEY, { type: 'text' }) as any;
    const at = Number(cached?.metadata?.at || 0);
    const age = Date.now() - at;
    if (cached?.value && at && age < BOOTSTRAP_STALE_MS) {
      if (age >= BOOTSTRAP_FRESH_MS) {
        ctx?.waitUntil?.(fetchRenderBootstrap(renderBase, body).then(text => text ? storeBootstrapSnapshot(store, text) : undefined).catch(() => undefined));
      }
      const payload = String(cached.value).replace(/\}\s*$/, ',"snapshotAgeMs":' + Math.max(0, age) + '}');
      return new Response(payload, { headers: { ...headers, 'x-zpc-bootstrap': age < BOOTSTRAP_FRESH_MS ? 'edge-fresh' : 'edge-stale' } });
    }
  } catch {}
  const text = await fetchRenderBootstrap(renderBase, body).catch(() => null);
  if (!text) return null;
  ctx?.waitUntil?.(storeBootstrapSnapshot(store, text));
  return new Response(text, { headers: { ...headers, 'x-zpc-bootstrap': 'origin' } });
}

function applyPanelSecurityHeaders(headers: Headers) {
  // Anti-clickjacking + transport hardening for the admin UI (no inline-script restrictions that
  // could break the SPA).
  headers.set('content-security-policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
  headers.set('x-frame-options', 'DENY');
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  return headers;
}

async function wakeCommercialRobot(env: Record<string, unknown>) {
  const secret = String(env.COMMERCIAL_ROBOT_TICK_SECRET || '');
  const renderBase = String(env.RENDER_BACKEND_URL || '').replace(/\/$/, '');
  if (secret.length < 32 || !renderBase) throw new Error('commercial_robot_tick_unconfigured');
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const signature = await commercialRobotTickSignature(secret, timestamp, nonce);
  const response = await fetch(renderBase + '/api/commercial/robot/tick', {
    method: 'POST',
    headers: {
      'x-commercial-timestamp': timestamp,
      'x-commercial-nonce': nonce,
      'x-commercial-signature': signature,
      'cache-control': 'no-store',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 240);
    throw new Error('commercial_robot_tick_http_' + response.status + '_' + detail);
  }
  return await response.json();
}


const T2_PRODUCT_SLUGS = ['ia-na-pratica','vendas-na-pratica','lucro-e-caixa','combo-ia-vendas','negocio-completo'] as const;
// Content calendar angles: owner-controlled hook copy (no invented facts). The caption always ends
// with the facts validated against the published sales page (name, description, price, URL).
const T2_PAIN_HOOKS: Record<string, string> = {
  'ia-na-pratica': 'Você usa IA no trabalho, mas toda vez começa do zero?',
  'vendas-na-pratica': 'Seus contatos esfriam porque falta um processo de follow-up?',
  'lucro-e-caixa': 'Vende bem, mas não sabe para onde vai o dinheiro do caixa?',
  'combo-ia-vendas': 'Quer organizar o atendimento e usar IA nas vendas ao mesmo tempo?',
  'negocio-completo': 'IA, vendas e caixa organizados em uma rotina só?',
};
const T2_ANGLES = ['oferta', 'dor', 'garantia', 'entrega'] as const;
type T2Angle = typeof T2_ANGLES[number];
function t2AngleHook(slug: string, angle: T2Angle) {
  if (angle === 'dor') return { kicker: 'Para quem tem esse problema', hook: T2_PAIN_HOOKS[slug] || '' };
  if (angle === 'garantia') return { kicker: 'Garantia de 7 dias', hook: 'Teste por 7 dias. Se não servir para você, o reembolso é integral.' };
  if (angle === 'entrega') return { kicker: 'Produto 100% digital', hook: 'O link de download chega no seu e-mail logo após a confirmação do pagamento.' };
  return { kicker: 'Produto 100% digital', hook: '' };
}

const T2_CREATIVE_BUCKET = 'zpc_commercial_creatives';

async function verifyFactoryRequest(request: Request, env: Record<string, unknown>) {
  const secrets = [env.COMMERCIAL_ROBOT_TICK_SECRET, env.CERTIFICATION_E2E_TOKEN]
    .map(value => String(value || ''))
    .filter(value => value.length >= 32);
  const timestamp = String(request.headers.get('x-commercial-timestamp') || '');
  const nonce = String(request.headers.get('x-commercial-nonce') || '');
  const signature = String(request.headers.get('x-commercial-signature') || '').toLowerCase();
  if (!secrets.length || !/^\d{13}$/.test(timestamp) || !/^[0-9a-f-]{36}$/i.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;
  const bytes = Uint8Array.from(signature.match(/.{2}/g) || [], pair => parseInt(pair, 16));
  const message = new TextEncoder().encode(['zevanory-commercial-creative-factory-v1', timestamp, nonce].join('\n'));
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (await crypto.subtle.verify('HMAC', key, bytes, message)) return true;
  }
  return false;
}

async function t2StoreCall(env: Record<string, unknown>, payload: Record<string, unknown>) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || '');
  const token = String(env.ZPC_REPLICATION_SECRET || '');
  if (!url || !key || !token) throw new Error('t2_store_unconfigured');
  const op = String(payload.op || '');
  const rpc = op === 'list' ? 'zpc_worker_list' : op === 'get' ? 'zpc_worker_get' : 'zpc_worker_upsert';
  const body: Record<string, unknown> = op === 'list'
    ? { p_token: token, p_bucket: payload.bucket, p_limit: payload.limit || 1000 }
    : op === 'get'
      ? { p_token: token, p_bucket: payload.bucket, p_ids: payload.ids || [] }
      : { p_token: token, p_bucket: payload.bucket, p_items: payload.items || [], p_operation: op, p_queue_primary: true };
  const response = await fetch(url + '/rest/v1/rpc/' + rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, authorization: 'Bearer ' + key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('t2_store_http_' + response.status + '_' + (await response.text()).slice(0, 180));
  return response.json() as Promise<any>;
}

async function t2SupportFact(slug: string, question: string) {
  const productUrl = 'https://vendas.zevanory.api.br/' + encodeURIComponent(slug);
  const response = await fetch(productUrl, {
    headers: { 'cache-control': 'no-store', accept: 'text/html' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('t2_catalog_http_' + response.status + '_' + slug);
  const html = await response.text();
  const title = (html.match(/<title>([^<]+)<\/title>/i)?.[1] || '').trim();
  const description = (html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1] || '').trim();
  const price = (html.match(/Pre[cç]o de tabela:\s*R\$\s*(\d+)/i)?.[1] || '').trim();
  const name = title.split('|')[0].trim();
  if (!name || !description || !price) throw new Error('t2_catalog_parse_failed_' + slug);
  const normalizedQuestion = String(question || '').toLowerCase();
  const answer = normalizedQuestion.includes('pre')
    ? name + ' custa R$ ' + price + ',00 (preço de tabela).'
    : name + ': ' + description;
  return { answered: true, product: slug, answer, sources: [productUrl], catalog: { name, description, price } };
}

async function t2ValidateCaption(caption: string, contentFact: any, priceFact: any, productUrl: string) {
  const required = [
    String(contentFact?.catalog?.name || ''),
    String(contentFact?.catalog?.description || ''),
    'R$ ' + String(priceFact?.catalog?.price || '') + ',00',
    productUrl,
  ];
  if (required.some(value => !value || !caption.includes(value))) {
    throw new Error('t2_catalog_caption_mismatch');
  }
  return { ok: true, source: 'published-sales-page', checks: ['name', 'description', 'price', 'url'] };
}

async function t2GenerateImage(env: Record<string, any>, prompt: string, seed: number) {
  if (!env.AI?.run) throw new Error('t2_ai_binding_missing');
  const form = new FormData();
  form.append('prompt', prompt);
  form.append('width', '1080');
  form.append('height', '1080');
  form.append('seed', String(seed));
  const serialized = new Response(form);
  const result = await env.AI.run('@cf/black-forest-labs/flux-2-klein-4b', {
    multipart: { body: serialized.body, contentType: serialized.headers.get('content-type') },
  }) as any;
  const image = String(result?.image || '');
  if (image.length < 1000) throw new Error('t2_ai_image_missing');
  const mime = image.startsWith('iVBOR') ? 'image/png' : 'image/jpeg';
  return 'data:' + mime + ';base64,' + image;
}

async function t2Sha256Hex(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyCreativeUploadRequest(request: Request, env: Record<string, unknown>, slug: string, bodyHash: string) {
  const secrets = [env.COMMERCIAL_ROBOT_TICK_SECRET, env.CERTIFICATION_E2E_TOKEN]
    .map(value => String(value || ''))
    .filter(value => value.length >= 32);
  const timestamp = String(request.headers.get('x-commercial-timestamp') || '');
  const nonce = String(request.headers.get('x-commercial-nonce') || '');
  const signature = String(request.headers.get('x-commercial-signature') || '').toLowerCase();
  if (!secrets.length || !/^\d{13}$/.test(timestamp) || !/^[0-9a-f-]{36}$/i.test(nonce) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60 * 1000) return false;
  const bytes = Uint8Array.from(signature.match(/.{2}/g) || [], pair => parseInt(pair, 16));
  const message = new TextEncoder().encode(['zevanory-commercial-creative-upload-v1', timestamp, nonce, slug, bodyHash].join('\n'));
  for (const secret of secrets) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (await crypto.subtle.verify('HMAC', key, bytes, message)) return true;
  }
  return false;
}

function t2JpegSize(bytes: Uint8Array) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i += 1; continue; }
    const marker = bytes[i + 1];
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}

// Text-free AI background for the deterministic compositor. Typography is never produced by the model.
async function t2Background(env: Record<string, any>, slug: string, seed: number) {
  const fact = await t2SupportFact(slug, 'conteúdo');
  const concept = String(fact.answer).replace(/^[^:]+:\s*/, '');
  const prompt = [
    'Abstract premium background texture for a Brazilian digital education brand.',
    'Theme mood: ' + concept,
    'Dark navy and electric blue light, soft volumetric glow, smooth gradients, subtle geometric light trails, cinematic depth of field.',
    'Pure abstract shapes and light only. Absolutely no text, letters, numbers, words, logos, screens, documents, signs or interfaces.',
  ].join(' ');
  const dataUrl = await t2GenerateImage(env, prompt, seed);
  const base64 = dataUrl.replace(/^data:image\/(?:jpeg|png);base64,/, '');
  return { bytes: Uint8Array.from(atob(base64), ch => ch.charCodeAt(0)), mime: dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg' };
}

async function t2StoreComposedCreative(env: Record<string, any>, slug: string, image: ArrayBuffer, bodyHash: string, angle: T2Angle = 'oferta') {
  const bytes = new Uint8Array(image);
  const size = t2JpegSize(bytes);
  if (!size || size.width !== 1080 || size.height !== 1080) throw new Error('t2_composed_image_must_be_1080_jpeg');
  const [contentFact, priceFact] = await Promise.all([t2SupportFact(slug, 'conteúdo'), t2SupportFact(slug, 'preço')]);
  const productUrl = 'https://vendas.zevanory.api.br/' + slug;
  const name = String(contentFact.catalog.name);
  const hook = t2AngleHook(slug, angle).hook;
  const caption = (hook ? hook + '\n\n' : '') + String(contentFact.answer).trim() + '\n\n' + String(priceFact.answer).trim() + '\n' + productUrl;
  await t2ValidateCaption(caption, contentFact, priceFact, productUrl);
  if (!env.T2_CREATIVE_ASSETS?.put) throw new Error('t2_asset_kv_binding_missing');
  const now = new Date().toISOString();
  const assetId = crypto.randomUUID();
  const sourceKey = 't2-workers-ai:' + slug;
  await env.T2_CREATIVE_ASSETS.put('t2-creative/v1/' + assetId, bytes, { metadata: { mime: 'image/jpeg', sourceKey, createdAt: now, sha256: bodyHash } });
  const imageUrl = 'https://controle.zevanory.api.br/api/commercial/creative/assets/' + assetId + '.jpg';
  const listed = await t2StoreCall(env, { op: 'list', bucket: T2_CREATIVE_BUCKET, limit: 1000 });
  const existing = (Array.isArray(listed?.items) ? listed.items : []).filter((item: any) => item?.sourceKey === sourceKey && item?.status === 'approval');
  const record = {
    kind: 'creative',
    title: 'Criativo · ' + name + (angle !== 'oferta' ? ' · ' + angle : ''),
    detail: caption,
    status: 'approval',
    channel: 'instagram-facebook',
    product: name,
    productId: null,
    valueCents: null,
    source: 'workers-ai',
    sourceKey,
    evidence: [
      'composer:deterministic-typography-v1',
      'background:@cf/black-forest-labs/flux-2-klein-4b',
      'catalogCaptionValidation:PASS',
      'angle:' + angle,
      'dimensions:1080x1080',
      'sha256:' + bodyHash,
      productUrl,
    ],
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
    imageUrl,
  };
  if (existing.length) {
    const [keep, ...duplicates] = existing;
    const items = [{ id: keep.id, record: { ...record, id: keep.id, createdAt: keep.createdAt || now } }];
    for (const dup of duplicates) items.push({ id: dup.id, record: { ...dup, status: 'archived', updatedAt: now, evidence: [...(Array.isArray(dup.evidence) ? dup.evidence : []), 'archived-by:t2-compose-dedupe', now].slice(-20) } });
    await t2StoreCall(env, { op: 'update', bucket: T2_CREATIVE_BUCKET, items });
  } else {
    await t2StoreCall(env, { op: 'add', bucket: T2_CREATIVE_BUCKET, items: [{ record }] });
  }
  return { ok: true, product: slug, imageUrl, caption, sha256: bodyHash, replaced: existing.length };
}

async function runT2CreativeFactory(
  env: Record<string, any>,
  options: { onlySlug?: string | null; finalizeOnly?: boolean; forceRegenerate?: boolean } = {},
) {
  const onlySlug = options.onlySlug ? String(options.onlySlug) : null;
  const forceRegenerate = options.forceRegenerate === true;
  if (onlySlug && !T2_PRODUCT_SLUGS.includes(onlySlug as any)) throw new Error('t2_product_slug_invalid_' + onlySlug);
  const listed = await t2StoreCall(env, { op: 'list', bucket: T2_CREATIVE_BUCKET, limit: 1000 });
  const existing = Array.isArray(listed?.items) ? listed.items : [];
  const generated: string[] = [];
  const skipped: string[] = [];
  const readySourceKeys = new Set(existing.filter((item: any) => item?.status === 'approval' && /^https:\/\//.test(String(item?.imageUrl || ''))).map((item: any) => String(item?.sourceKey || '')));
  const firstMissingSlug = T2_PRODUCT_SLUGS.find(slug => !readySourceKeys.has('t2-workers-ai:' + slug)) || null;
  const targetSlugs = options.finalizeOnly ? [] : (onlySlug ? [onlySlug] : (firstMissingSlug ? [firstMissingSlug] : []));

  for (const slug of targetSlugs) {
    const index = T2_PRODUCT_SLUGS.indexOf(slug as any);
    const sourceKey = 't2-workers-ai:' + slug;
    const ready = existing.find((item: any) => item?.sourceKey === sourceKey && item?.status === 'approval' && /^https:\/\//.test(String(item?.imageUrl || '')));
    if (ready && !forceRegenerate) { skipped.push(slug); continue; }

    const [contentFact, priceFact] = await Promise.all([
      t2SupportFact(slug, 'conteúdo'),
      t2SupportFact(slug, 'preço'),
    ]);
    const productUrl = [...(contentFact.sources || []), ...(priceFact.sources || [])].find((value: unknown) => typeof value === 'string' && String(value).includes('/' + slug));
    if (!productUrl) throw new Error('t2_product_url_missing_' + slug);
    const name = String(contentFact.answer).split(':')[0].trim();
    if (!name) throw new Error('t2_product_name_missing_' + slug);
    const caption = String(contentFact.answer).trim() + '\n\n' + String(priceFact.answer).trim() + '\n' + String(productUrl);
    await t2ValidateCaption(caption, contentFact, priceFact, String(productUrl));

    const visualConceptBySlug: Record<string, string> = {
      'ia-na-pratica': 'abstract luminous neural network made only of glowing blue nodes, flowing light paths and geometric depth',
      'vendas-na-pratica': 'abstract commercial momentum shown only through converging blue light paths, forward motion and geometric depth',
      'lucro-e-caixa': 'abstract financial flow shown only through balanced blue light streams, layered geometric forms and calm depth',
      'combo-ia-vendas': 'abstract fusion of two luminous blue systems joining into one coherent geometric network',
      'negocio-completo': 'abstract integrated business ecosystem shown only through connected luminous modules and deep geometric space',
    };
    const prompt = [
      'Square abstract premium technology artwork.',
      visualConceptBySlug[slug] || 'abstract blue geometric technology composition',
      'Dark navy background, electric blue light, cinematic depth, elegant minimal composition, generous negative space.',
      'No people. No products. No screens. No signs. No documents. No packaging. No labels. No interface elements.',
      'No branding and absolutely no typography or text-like marks: no words, letters, numbers, symbols, logos, watermarks or captions.',
      'The image must be purely abstract geometry and light.',
    ].join(' ');
    const imageDataUrl = await t2GenerateImage(env, prompt, (forceRegenerate ? 12100 : 2100) + index);
    const now = new Date().toISOString();
    const assetId = crypto.randomUUID();
    const imageBase64 = imageDataUrl.replace(/^data:image\/(?:jpeg|png);base64,/, '');
    const imageMime = imageDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
    if (!env.T2_CREATIVE_ASSETS?.put) throw new Error('t2_asset_kv_binding_missing');
    const imageBytes = Uint8Array.from(atob(imageBase64), ch => ch.charCodeAt(0));
    const assetKey = 't2-creative/v1/' + assetId;
    await env.T2_CREATIVE_ASSETS.put(assetKey, imageBytes, { metadata: { mime: imageMime, sourceKey, createdAt: now } });
    const imageUrl = 'https://controle.zevanory.api.br/api/commercial/creative/assets/' + assetId + (imageMime === 'image/png' ? '.png' : '.jpg');
    const record = {
      kind: 'creative',
      title: 'Criativo · ' + name,
      detail: caption,
      status: 'approval',
      channel: 'instagram-facebook',
      product: name,
      productId: null,
      valueCents: null,
      source: 'workers-ai',
      sourceKey,
      evidence: [
        'model:@cf/black-forest-labs/flux-2-klein-4b',
        'catalogCaptionValidation:PASS',
        'dimensions:1080x1080',
        String(productUrl),
      ],
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      imageUrl,
    };
    if (ready && forceRegenerate) {
      await t2StoreCall(env, { op: 'update', bucket: T2_CREATIVE_BUCKET, items: [{ id: ready.id, record: { ...record, id: ready.id } }] });
    } else {
      await t2StoreCall(env, { op: 'add', bucket: T2_CREATIVE_BUCKET, items: [{ record }] });
    }
    generated.push(slug);
  }

  let after = await t2StoreCall(env, { op: 'list', bucket: T2_CREATIVE_BUCKET, limit: 1000 });
  let current = Array.isArray(after?.items) ? after.items : [];
  const approvalBySourceKey = new Map<string, any>();
  for (const item of current) {
    const sourceKey = String(item?.sourceKey || '');
    if (
      sourceKey.startsWith('t2-workers-ai:') &&
      item?.status === 'approval' &&
      /^https:\/\//.test(String(item?.imageUrl || ''))
    ) approvalBySourceKey.set(sourceKey, item);
  }
  const approvals = [...approvalBySourceKey.values()];
  const shouldFinalize = options.finalizeOnly || (!onlySlug && approvals.length >= 5);
  if (shouldFinalize && approvals.length < 5) throw new Error('t2_approval_count_' + approvals.length);

  if (shouldFinalize) {
    const today = new Date().toISOString().slice(0, 10);
    const briefs = current.filter((item: any) =>
      item?.status === 'brief' &&
      !item?.imageDataUrl &&
      String(item?.createdAt || '').slice(0, 10) < today
    );
    if (briefs.length) {
      const archivedAt = new Date().toISOString();
      const items = briefs.map((item: any) => ({
        id: item.id,
        record: {
          ...item,
          status: 'archived',
          updatedAt: archivedAt,
          evidence: [...(Array.isArray(item.evidence) ? item.evidence : []), 'archived-by:t2-creative-factory', archivedAt].slice(-20),
        },
      }));
      await t2StoreCall(env, { op: 'update', bucket: T2_CREATIVE_BUCKET, items });
      after = await t2StoreCall(env, { op: 'list', bucket: T2_CREATIVE_BUCKET, limit: 1000 });
      current = Array.isArray(after?.items) ? after.items : [];
    }
  }

  const archivedBriefs = current.filter((item: any) =>
    item?.status === 'archived' &&
    Array.isArray(item?.evidence) &&
    item.evidence.includes('archived-by:t2-creative-factory')
  ).length;

  return {
    ok: true,
    generated,
    skipped,
    approvals: approvals.length,
    archivedBriefs,
    creativeProof: approvals.map((item: any) => ({
      id: item.id,
      product: item.product,
      sourceKey: item.sourceKey,
      status: item.status,
      imageUrl: item.imageUrl,
      caption: item.detail,
      evidence: item.evidence,
    })),
    at: new Date().toISOString(),
  };
}

// T3 — Meta publisher. Publishes ONLY creatives the owner approved in the panel (status "approved").
// One secret: META_SYSTEM_TOKEN (Business system-user token). IDs are discovered at runtime.
const META_GRAPH = 'https://graph.facebook.com/';
const META_PAGE_ID = '1249902628211703';

async function metaCall(env: Record<string, any>, path: string, params: Record<string, string> = {}, method: 'GET' | 'POST' = 'GET', token?: string) {
  const version = String(env.META_GRAPH_VERSION || 'v23.0');
  const body = new URLSearchParams({ ...params, access_token: String(token || env.META_SYSTEM_TOKEN || '') });
  const url = META_GRAPH + version + '/' + path + (method === 'GET' ? '?' + body.toString() : '');
  const response = await fetch(url, method === 'GET' ? { signal: AbortSignal.timeout(15_000) } : { method: 'POST', body, signal: AbortSignal.timeout(30_000) });
  const json = await response.json().catch(() => ({})) as any;
  if (!response.ok || json?.error) throw new Error('meta_' + path.split('?')[0].replace(/[^a-z0-9_]/gi, '_') + '_' + (json?.error?.code || response.status) + '_' + String(json?.error?.message || '').slice(0, 120));
  return json;
}

async function metaTargets(env: Record<string, any>) {
  if (!String(env.META_SYSTEM_TOKEN || '')) throw new Error('meta_token_missing');
  const page = await metaCall(env, META_PAGE_ID, { fields: 'id,name,access_token,instagram_business_account{id,username}' });
  if (!page?.access_token) throw new Error('meta_page_token_unavailable');
  const ig = page?.instagram_business_account;
  if (!ig?.id) throw new Error('meta_instagram_not_linked');
  return { pageId: String(page.id), pageName: String(page.name || ''), pageToken: String(page.access_token), igId: String(ig.id), igUsername: String(ig.username || '') };
}

async function metaPublishStatus(env: Record<string, any>) {
  try {
    const t = await metaTargets(env);
    let inbound = 'not_subscribed';
    const subscribed: string[] = [];
    for (const field of ['feed', 'messages']) {
      try {
        await metaCall(env, t.pageId + '/subscribed_apps', { subscribed_fields: [...subscribed, field].join(',') }, 'POST', t.pageToken);
        subscribed.push(field);
      } catch {}
    }
    inbound = subscribed.length ? 'subscribed:' + subscribed.join(',') + (String(env.META_APP_SECRET || '').length >= 16 ? '' : ':missing_app_secret') : 'subscribe_failed';
    return { ready: true, page: t.pageName, instagram: t.igUsername, inbound };
  } catch (error) {
    return { ready: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function runT3Publisher(env: Record<string, any>, limit = 1) {
  const listed = await t2StoreCall(env, { op: 'list', bucket: T2_CREATIVE_BUCKET, limit: 1000 });
  const items = (Array.isArray(listed?.items) ? listed.items : [])
    .filter((item: any) => item?.kind === 'creative' && item?.status === 'approved' && !item?.publishedAt && /^https:\/\//.test(String(item?.imageUrl || '')));
  if (!items.length) return { ok: true, published: [], pending: 0 };
  const targets = await metaTargets(env);
  const published: any[] = [];
  for (const item of items.slice(0, limit)) {
    const caption = String(item.detail || '').slice(0, 2100);
    const evidence: string[] = Array.isArray(item.evidence) ? item.evidence.map(String) : [];
    const findEvidence = (prefix: string) => evidence.find(e => e.startsWith(prefix))?.slice(prefix.length) || '';
    // Each network is published at most once: its id is persisted immediately, so a failure on the
    // other network never causes a duplicate post on retry.
    let igId = findEvidence('instagram_media_id:');
    if (!igId) {
      const container = await metaCall(env, targets.igId + '/media', { image_url: String(item.imageUrl), caption }, 'POST', targets.pageToken);
      let ready = false;
      for (let i = 0; i < 10 && !ready; i++) {
        const st = await metaCall(env, String(container.id), { fields: 'status_code' }, 'GET', targets.pageToken);
        if (st?.status_code === 'FINISHED') ready = true;
        else if (st?.status_code === 'ERROR' || st?.status_code === 'EXPIRED') throw new Error('meta_ig_container_' + st.status_code);
        else await new Promise(r => setTimeout(r, 3000));
      }
      if (!ready) throw new Error('meta_ig_container_timeout');
      const igPost = await metaCall(env, targets.igId + '/media_publish', { creation_id: String(container.id) }, 'POST', targets.pageToken);
      igId = String(igPost.id);
      evidence.push('instagram_media_id:' + igId);
      await t2StoreCall(env, { op: 'update', bucket: T2_CREATIVE_BUCKET, items: [{ id: item.id, record: { ...item, evidence: evidence.slice(-20), updatedAt: new Date().toISOString() } }] });
    }
    let fbId = findEvidence('facebook_post_id:');
    if (!fbId) {
      const fbPost = await metaCall(env, targets.pageId + '/photos', { url: String(item.imageUrl), message: caption, published: 'true' }, 'POST', targets.pageToken);
      fbId = String(fbPost.post_id || fbPost.id);
      evidence.push('facebook_post_id:' + fbId);
    }
    const now = new Date().toISOString();
    const record = {
      ...item,
      status: 'published',
      publishedAt: now,
      updatedAt: now,
      evidence: [...evidence, 'published-by:t3-meta-publisher', now].slice(-20),
    };
    await t2StoreCall(env, { op: 'update', bucket: T2_CREATIVE_BUCKET, items: [{ id: item.id, record }] });
    const igPost = { id: igId };
    const fbPost = { id: fbId, post_id: fbId };
    published.push({ id: item.id, product: item.product, instagram: igPost.id, facebook: fbPost.post_id || fbPost.id });
    await recordCommercialActivity(env, 'event', {
      title: 'Publicado no Instagram e Facebook · ' + String(item.product || item.title || 'ZEVANORY'),
      detail: caption.slice(0, 600),
      status: 'published',
      channel: 'instagram,facebook',
      product: String(item.product || 'ZEVANORY'),
      sourceKey: 'meta-publish:' + item.id,
      evidence: ['instagram_media_id:' + igPost.id, 'facebook_post_id:' + (fbPost.post_id || fbPost.id), 'approved-by-owner', now],
    });
  }
  return { ok: true, published, pending: items.length - published.length };
}

// T4 — Inbound capture on Instagram/Facebook: grounded replies to comments and DMs. No cold outreach:
// the bot only answers people who wrote to ZEVANORY first. Answers come from the published support
// knowledge (zevanory.api.br/api/support/knowledge); anything else is routed to WhatsApp.
const META_WEBHOOK_VERIFY_TOKEN = 'zevanory-meta-webhook-v1';
const WHATSAPP_LINK = 'https://wa.me/5588992545413';

async function metaVerifySignature(request: Request, raw: string, env: Record<string, any>) {
  const secret = String(env.META_APP_SECRET || '');
  const header = String(request.headers.get('x-hub-signature-256') || '');
  if (secret.length < 16 || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7).toLowerCase();
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function groundedAnswer(text: string): Promise<{ text: string; grounded: boolean }> {
  const q = String(text || '').slice(0, 500);
  try {
    const r = await fetch('https://zevanory.api.br/api/support/knowledge?q=' + encodeURIComponent(q), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    const j = await r.json() as any;
    if (r.ok && j?.answered && j?.answer) {
      const link = Array.isArray(j.sources) ? String(j.sources[0] || '') : '';
      return { text: (String(j.answer) + (link ? '\n' + link : '')).slice(0, 900), grounded: true };
    }
  } catch {}
  return { text: 'Olá! Obrigado pelo contato com a ZEVANORY. Veja os produtos em https://vendas.zevanory.api.br/solucoes ou fale com o atendimento no WhatsApp: ' + WHATSAPP_LINK, grounded: false };
}

// Panel visibility: every robot action on Meta becomes an auditable record in the commercial
// workspace (Atendimento / CRM / Atividade). Best-effort: a logging failure never blocks a reply.
const COMMERCIAL_BUCKETS = {
  support: 'zpc_commercial_support',
  event: 'zpc_commercial_events',
  lead: 'zpc_commercial_leads',
} as const;

async function recordCommercialActivity(env: Record<string, any>, kind: keyof typeof COMMERCIAL_BUCKETS, input: {
  title: string; detail: string; status: string; channel: string; sourceKey: string; evidence: string[]; product?: string | null;
}) {
  try {
    const now = new Date().toISOString();
    const record = {
      kind,
      title: input.title.slice(0, 180),
      detail: input.detail.slice(0, 4000),
      status: input.status,
      channel: input.channel,
      product: input.product ?? 'ZEVANORY',
      productId: null,
      valueCents: null,
      source: 'meta-robot',
      sourceKey: input.sourceKey.slice(0, 220),
      evidence: input.evidence.map(item => String(item).slice(0, 1000)).slice(0, 20),
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
    };
    await t2StoreCall(env, { op: 'add', bucket: COMMERCIAL_BUCKETS[kind], items: [{ record }] });
    return true;
  } catch (error) {
    console.error('commercial_activity_record_failed', error instanceof Error ? error.message : String(error));
    return false;
  }
}

// Bridge for robots running in other Workers that share this KV namespace (e.g. the post-sale
// robot in the main ZEVANORY Worker): they drop `zpc-activity:v1:<kind>:<ts>:<id>` entries and the
// panel cron turns them into commercial records, then deletes the entries.
async function syncSharedActivity(env: Record<string, any>) {
  const kv = env.T2_CREATIVE_ASSETS;
  if (!kv?.list) return { synced: 0 };
  const listed = await kv.list({ prefix: 'zpc-activity:v1:', limit: 100 });
  let synced = 0;
  for (const key of listed.keys || []) {
    const name = String(key.name);
    const kind = name.split(':')[2];
    if (kind !== 'event' && kind !== 'support' && kind !== 'lead') { await kv.delete(name); continue; }
    const raw = await kv.get(name);
    let data: any = null;
    try { data = JSON.parse(String(raw || '')); } catch {}
    if (data && typeof data.title === 'string' && data.title) {
      const stored = await recordCommercialActivity(env, kind as keyof typeof COMMERCIAL_BUCKETS, {
        title: String(data.title),
        detail: String(data.detail || ''),
        status: String(data.status || 'recorded').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80),
        channel: String(data.channel || 'email').slice(0, 120),
        product: data.product ? String(data.product) : 'ZEVANORY',
        sourceKey: String(data.sourceKey || name),
        evidence: Array.isArray(data.evidence) ? data.evidence.map(String) : [name],
      });
      if (!stored) continue; // keep the entry; next cron retries
      synced += 1;
    }
    await kv.delete(name);
  }
  return { synced };
}

async function recordMetaConversation(env: Record<string, any>, input: {
  channel: 'instagram' | 'facebook'; type: 'comentário' | 'mensagem'; eventId: string; authorId: string; authorName: string;
  incoming: string; answer: { text: string; grounded: boolean };
}) {
  const who = input.authorName ? '@' + input.authorName.replace(/^@/, '') : 'pessoa ' + input.authorId.slice(-4);
  await recordCommercialActivity(env, 'support', {
    title: (input.channel === 'instagram' ? 'Instagram' : 'Facebook') + ' · ' + input.type + ' de ' + who + (input.answer.grounded ? ' respondido' : ' encaminhado ao WhatsApp'),
    detail: 'Cliente: ' + input.incoming.slice(0, 600) + '\n\nRobô: ' + input.answer.text,
    status: input.answer.grounded ? 'answered' : 'routed-whatsapp',
    channel: input.channel,
    sourceKey: 'meta:' + input.eventId,
    evidence: ['meta-event:' + input.eventId, 'grounded:' + input.answer.grounded, 'inbound-only', new Date().toISOString()],
  });
  // Someone who wrote to ZEVANORY first is a warm inbound lead (never cold outreach).
  if (input.authorId && !(await seenOnce(env, 'lead:' + input.channel + ':' + input.authorId))) {
    await recordCommercialActivity(env, 'lead', {
      title: who + ' (' + (input.channel === 'instagram' ? 'Instagram' : 'Facebook') + ')',
      detail: 'Lead inbound: iniciou contato por ' + input.type + '. Primeira mensagem: ' + input.incoming.slice(0, 300),
      status: 'conversation',
      channel: input.channel,
      sourceKey: 'meta-lead:' + input.channel + ':' + input.authorId,
      evidence: ['inbound-first-contact', 'meta-author:' + input.authorId, 'no-cold-outreach', new Date().toISOString()],
    });
  }
}

async function seenBefore(env: Record<string, any>, id: string) {
  const kv = env.T2_CREATIVE_ASSETS;
  if (!kv?.get || !id) return false;
  return Boolean(await kv.get('t4-meta-seen:' + id));
}

async function markSeen(env: Record<string, any>, id: string) {
  const kv = env.T2_CREATIVE_ASSETS;
  if (!kv?.put || !id) return;
  try { await kv.put('t4-meta-seen:' + id, '1', { expirationTtl: 7 * 24 * 3600 }); } catch {}
}

// Back-compat helper (lead dedupe): read-then-mark.
async function seenOnce(env: Record<string, any>, id: string) {
  if (await seenBefore(env, id)) return true;
  await markSeen(env, id);
  return false;
}

const ESCALATION_RE = /golpe|fraude|procon|advogad|processo|absurdo|n[aã]o recebi|cad[eê] (meu|o) (produto|acesso|link)|reembols|estorno|cancelar|humano|atendente|pessoa real|reclame aqui/i;

// Owner alert through the shared KV bridge; the main Worker emails a digest to the owner.
async function alertOwner(env: Record<string, any>, input: { channel: string; reason: string; excerpt: string; eventId: string }) {
  const kv = env.T2_CREATIVE_ASSETS;
  if (!kv?.put) return;
  const excerpt = input.excerpt.replace(/\b\d{6,}\b/g, '***').replace(/[^\s@]+@[^\s@]+/g, '***@***').slice(0, 280);
  try {
    await kv.put('zpc-alert:v1:' + Date.now() + ':' + input.eventId.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 60), JSON.stringify({ channel: input.channel, reason: input.reason, excerpt, at: new Date().toISOString() }), { expirationTtl: 7 * 24 * 3600 });
  } catch {}
}

async function handleMetaWebhook(request: Request, env: Record<string, any>) {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === META_WEBHOOK_VERIFY_TOKEN) {
      return new Response(String(url.searchParams.get('hub.challenge') || ''), { headers: { 'content-type': 'text/plain' } });
    }
    return new Response('forbidden', { status: 403 });
  }
  if (request.method !== 'POST') return new Response('method_not_allowed', { status: 405 });
  const raw = await request.text();
  if (!await metaVerifySignature(request, raw, env)) return new Response('invalid_signature', { status: 401 });
  let body: any = {};
  try { body = JSON.parse(raw); } catch { return new Response('ok'); }
  let targets: any = null;
  const handled: string[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    try {
      targets = targets || await metaTargets(env);
      const own = new Set([targets.igId, targets.pageId]);
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const v = change?.value || {};
        if (body.object === 'instagram' && change.field === 'comments' && v.id && v.text && !own.has(String(v.from?.id || ''))) {
          if (await seenBefore(env, 'igc:' + v.id)) continue;
          const answer = await groundedAnswer(v.text);
          await metaCall(env, String(v.id) + '/replies', { message: answer.text }, 'POST', targets.pageToken);
          await markSeen(env, 'igc:' + v.id);
          handled.push('ig_comment');
          if (!answer.grounded || ESCALATION_RE.test(String(v.text))) await alertOwner(env, { channel: 'instagram', reason: answer.grounded ? 'atencao' : 'sem-resposta-na-base', excerpt: String(v.text), eventId: 'igc:' + v.id });
          await recordMetaConversation(env, { channel: 'instagram', type: 'comentário', eventId: 'igc:' + v.id, authorId: String(v.from?.id || ''), authorName: String(v.from?.username || ''), incoming: String(v.text), answer });
        }
        if (body.object === 'page' && change.field === 'feed' && v.item === 'comment' && v.verb === 'add' && v.comment_id && v.message && !own.has(String(v.from?.id || ''))) {
          if (await seenBefore(env, 'fbc:' + v.comment_id)) continue;
          const answer = await groundedAnswer(v.message);
          await metaCall(env, String(v.comment_id) + '/comments', { message: answer.text }, 'POST', targets.pageToken);
          await markSeen(env, 'fbc:' + v.comment_id);
          handled.push('fb_comment');
          if (!answer.grounded || ESCALATION_RE.test(String(v.message))) await alertOwner(env, { channel: 'facebook', reason: answer.grounded ? 'atencao' : 'sem-resposta-na-base', excerpt: String(v.message), eventId: 'fbc:' + v.comment_id });
          await recordMetaConversation(env, { channel: 'facebook', type: 'comentário', eventId: 'fbc:' + v.comment_id, authorId: String(v.from?.id || ''), authorName: String(v.from?.name || ''), incoming: String(v.message), answer });
        }
      }
      for (const m of Array.isArray(entry?.messaging) ? entry.messaging : []) {
        const sender = String(m?.sender?.id || '');
        const text = String(m?.message?.text || '');
        if (!sender || !text || m?.message?.is_echo || own.has(sender)) continue;
        const dmId = 'dm:' + String(m?.message?.mid || sender + ':' + m?.timestamp);
        if (await seenBefore(env, dmId)) continue;
        const answer = await groundedAnswer(text);
        await metaCall(env, targets.pageId + '/messages', {
          recipient: JSON.stringify({ id: sender }),
          messaging_type: 'RESPONSE',
          message: JSON.stringify({ text: answer.text }),
        }, 'POST', targets.pageToken);
        await markSeen(env, dmId);
        handled.push(body.object === 'instagram' ? 'ig_dm' : 'fb_dm');
        if (!answer.grounded || ESCALATION_RE.test(text)) await alertOwner(env, { channel: body.object === 'instagram' ? 'instagram-dm' : 'facebook-dm', reason: answer.grounded ? 'atencao' : 'sem-resposta-na-base', excerpt: text, eventId: dmId });
        await recordMetaConversation(env, { channel: body.object === 'instagram' ? 'instagram' : 'facebook', type: 'mensagem', eventId: dmId, authorId: sender, authorName: '', incoming: text, answer });
      }
    } catch (error) {
      console.error('meta_webhook_entry_failed', error instanceof Error ? error.message : String(error));
    }
  }
  if (handled.length) console.info('meta_webhook_handled', JSON.stringify(handled));
  return new Response('ok');
}

async function fetchPagesOrigin(pathname: string) {
  const target = PAGES_ORIGIN + (pathname === '/' ? '/' : pathname);
  const response = await fetch(target, {
    headers: { 'Cache-Control': 'no-cache', Accept: '*/*' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) return null;
  const headers = new Headers(response.headers);
  headers.set('cache-control', pathname === '/global-trust.json' || pathname === '/zpc-build.json' ? 'no-store, max-age=0' : 'public, max-age=60');
  headers.set('x-zpc-origin', 'github-pages');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async scheduled(_controller: ScheduledController, env: Record<string, unknown>) {
    try {
      const result = await wakeCommercialRobot(env);
      console.info('commercial_robot_cron_tick', JSON.stringify(result));
    } catch (error) {
      console.error('commercial_robot_cron_tick_failed', error instanceof Error ? error.message : String(error));
    }
    try {
      if (String((env as any).META_SYSTEM_TOKEN || '')) {
        const publish = await runT3Publisher(env as Record<string, any>, 1);
        console.info('commercial_meta_publisher_cron', JSON.stringify(publish));
      }
    } catch (error) {
      console.error('commercial_meta_publisher_cron_failed', error instanceof Error ? error.message : String(error));
    }
    try {
      const bridge = await syncSharedActivity(env as Record<string, any>);
      if (bridge.synced) console.info('shared_activity_synced', JSON.stringify(bridge));
    } catch (error) {
      console.error('shared_activity_sync_failed', error instanceof Error ? error.message : String(error));
    }
    // Creatives are produced by the deterministic compositor (model background + exact catalog typography);
    // the cron never generates images with model-rendered text.
  },

  async fetch(request: Request, env: Record<string, unknown>, ctx?: any) {
    setWorkerEnv(env);
    setSessionRevocationStore((env as any).T2_CREATIVE_ASSETS || null);
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/commercial/creative/assets-raw/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
      const match = url.pathname.match(/^\/api\/commercial\/creative\/assets-raw\/([0-9a-f-]{36})\.(jpg|png)$/i);
      if (!match) return Response.json({ ok: false, error: 'creative_asset_invalid' }, { status: 400 });
      try {
        if (!env.T2_CREATIVE_ASSETS?.getWithMetadata) return Response.json({ ok: false, error: 'creative_asset_store_unavailable' }, { status: 503 });
        const asset = await env.T2_CREATIVE_ASSETS.getWithMetadata('t2-creative/v1/' + match[1], { type: 'arrayBuffer' }) as any;
        if (!asset?.value) return Response.json({ ok: false, error: 'creative_asset_not_found' }, { status: 404 });
        const mime = String(asset?.metadata?.mime || (match[2].toLowerCase() === 'png' ? 'image/png' : 'image/jpeg'));
        return new Response(request.method === 'HEAD' ? null : asset.value, { headers: { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
      } catch {
        return Response.json({ ok: false, error: 'creative_asset_read_failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
      }
    }

    if (url.pathname.startsWith('/api/commercial/creative/assets/')) {
      if (request.method !== 'GET' && request.method !== 'HEAD') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
      const match = url.pathname.match(/^\/api\/commercial\/creative\/assets\/([0-9a-f-]{36})\.(jpg|png)$/i);
      if (!match) return Response.json({ ok: false, error: 'creative_asset_invalid' }, { status: 400 });
      try {
        const rawUrl = new URL('/api/commercial/creative/assets-raw/' + match[1] + '.' + match[2].toLowerCase(), request.url);
        const transformed = await fetch(rawUrl.toString(), {
          cf: { image: { width: 1080, height: 1080, fit: 'cover', format: match[2].toLowerCase() === 'png' ? 'png' : 'jpeg', quality: 95 } },
        } as any);
        if (!transformed.ok) return transformed;
        const headers = new Headers(transformed.headers);
        headers.set('cache-control', 'public, max-age=31536000, immutable');
        headers.set('x-content-type-options', 'nosniff');
        headers.set('x-zpc-image-size', '1080x1080');
        return new Response(request.method === 'HEAD' ? null : transformed.body, { status: transformed.status, headers });
      } catch {
        return Response.json({ ok: false, error: 'creative_asset_transform_failed' }, { status: 500, headers: { 'cache-control': 'no-store' } });
      }
    }

    if (url.pathname === '/api/commercial/creative/background') {
      if (request.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
      if (!await verifyFactoryRequest(request, env)) return Response.json({ ok: false, error: 'commercial_creative_factory_auth_required' }, { status: 401 });
      const slug = String(url.searchParams.get('product') || '');
      if (!T2_PRODUCT_SLUGS.includes(slug as any)) return Response.json({ ok: false, error: 'product_invalid' }, { status: 400 });
      try {
        const seed = Number(url.searchParams.get('seed')) || (Date.now() % 100000);
        const bg = await t2Background(env as Record<string, any>, slug, seed);
        return new Response(bg.bytes, { headers: { 'content-type': bg.mime, 'cache-control': 'no-store' } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ ok: false, error: message }, { status: 500, headers: { 'cache-control': 'no-store' } });
      }
    }

    if (url.pathname === '/api/commercial/creative/angles' && request.method === 'GET') {
      const out: Record<string, Record<string, { kicker: string; hook: string }>> = {};
      for (const slug of T2_PRODUCT_SLUGS) { out[slug] = {}; for (const angle of T2_ANGLES) out[slug][angle] = t2AngleHook(slug, angle); }
      return Response.json({ ok: true, angles: T2_ANGLES, copy: out }, { headers: { 'cache-control': 'public, max-age=300' } });
    }

    if (url.pathname === '/api/commercial/creative/upload') {
      if (request.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
      const slug = String(url.searchParams.get('product') || '');
      if (!T2_PRODUCT_SLUGS.includes(slug as any)) return Response.json({ ok: false, error: 'product_invalid' }, { status: 400 });
      const body = await request.arrayBuffer();
      if (body.byteLength < 20_000 || body.byteLength > 5_000_000) return Response.json({ ok: false, error: 'creative_size_invalid' }, { status: 400 });
      const bodyHash = await t2Sha256Hex(body);
      if (!await verifyCreativeUploadRequest(request, env, slug, bodyHash)) return Response.json({ ok: false, error: 'commercial_creative_upload_auth_required' }, { status: 401 });
      try {
        const angleParam = String(url.searchParams.get('angle') || 'oferta');
        if (!(T2_ANGLES as readonly string[]).includes(angleParam)) return Response.json({ ok: false, error: 'angle_invalid' }, { status: 400 });
        const result = await t2StoreComposedCreative(env as Record<string, any>, slug, body, bodyHash, angleParam as T2Angle);
        return Response.json(result, { headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ ok: false, error: message }, { status: 500, headers: { 'cache-control': 'no-store' } });
      }
    }

    if (url.pathname === '/api/meta/webhook') return handleMetaWebhook(request, env as Record<string, any>);

    if (url.pathname === '/api/commercial/publish/status' && request.method === 'GET') {
      // Has side effects on Meta (subscribed_apps) and reveals account wiring: HMAC-authenticated only.
      if (!await verifyFactoryRequest(request, env)) return Response.json({ ok: false, error: 'commercial_publish_auth_required' }, { status: 401, headers: { 'cache-control': 'no-store' } });
      return Response.json(await metaPublishStatus(env as Record<string, any>), { headers: { 'cache-control': 'no-store' } });
    }

    if (url.pathname === '/api/commercial/publish/tick') {
      if (request.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
      if (!await verifyFactoryRequest(request, env)) return Response.json({ ok: false, error: 'commercial_publish_auth_required' }, { status: 401 });
      try {
        return Response.json(await runT3Publisher(env as Record<string, any>, 1), { headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: { 'cache-control': 'no-store' } });
      }
    }

    if (url.pathname === '/api/commercial/creative/factory/tick') {
      if (request.method !== 'POST') return Response.json({ ok: false, error: 'method_not_allowed' }, { status: 405 });
      if (!await verifyFactoryRequest(request, env)) return Response.json({ ok: false, error: 'commercial_creative_factory_auth_required' }, { status: 401 });
      try {
        const product = url.searchParams.get('product');
        const finalizeOnly = url.searchParams.get('finalize') === '1';
        const forceRegenerate = url.searchParams.get('force') === '1';
        const result = await runT2CreativeFactory(env as Record<string, any>, { onlySlug: product, finalizeOnly, forceRegenerate });
        return Response.json(result, { headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('commercial_creative_factory_failed', message);
        return Response.json({ ok: false, error: message }, { status: 500, headers: { 'cache-control': 'no-store' } });
      }
    }
    if (url.hostname === 'zevanory.api.br') {
      const suffix = url.pathname === '/control'
        ? '/'
        : url.pathname.startsWith('/control/')
          ? url.pathname.slice('/control'.length)
          : url.pathname;
      const canonical = new URL(CANONICAL_PUBLIC_ORIGIN + suffix + url.search);
      return Response.redirect(canonical.toString(), 308);
    }
    const normalizedPath = url.hostname === 'controle.zevanory.api.br' && url.pathname.startsWith('/control/')
      ? url.pathname.slice('/control'.length)
      : url.pathname;
    const normalizedUrl = new URL(request.url);
    normalizedUrl.pathname = normalizedPath;
    const normalizedRequest = new Request(normalizedUrl.toString(), request);

    const publicPath = normalizedPath.startsWith('/produtos/')
      ? normalizedPath.slice('/produtos'.length)
      : normalizedPath;
    const retiredPublicPaths = new Set(['/arbm-sist','/zevanory-one','/arbm-one']);
    if (retiredPublicPaths.has(publicPath)) {
      return new Response('Produto retirado da superficie publica ZEVANORY.', { status: 410, headers: { 'cache-control':'no-store' } });
    }
    const salesPublicPaths = new Set(['/solucoes','/zevanory-cfo','/arbm-contador-saloes','/ia-na-pratica','/vendas-na-pratica','/lucro-e-caixa','/combo-ia-vendas','/negocio-completo','/termos','/privacidade','/reembolso','/afiliados']);
    if (salesPublicPaths.has(publicPath)) {
      return Response.redirect('https://vendas.zevanory.api.br' + publicPath + url.search, 308);
    }

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

    const publicProductMap: Record<string,string> = {
      '/produtos/zevanory-one':'/zevanory-one',
      '/produtos/arbm-contador-saloes':'/arbm-contador-saloes',
      '/produtos/arbm-sist':'/arbm-sist',
      '/produtos/ia-na-pratica':'/ia-na-pratica',
      '/produtos/vendas-na-pratica':'/vendas-na-pratica',
      '/produtos/lucro-e-caixa':'/lucro-e-caixa',
      '/produtos/combo-ia-vendas':'/combo-ia-vendas',
      '/produtos/negocio-completo':'/negocio-completo',
    };

    const publicStaticMap: Record<string,string> = {
      '/solucoes':'/solucoes',
      '/termos':'/termos',
      '/privacidade':'/privacidade',
      '/reembolso':'/reembolso',
      '/assets/product.css':'/product.css',
    };

    const mirrorPath = publicProductMap[normalizedPath]
      || publicStaticMap[normalizedPath]
      || (normalizedPath.startsWith('/brand/') ? normalizedPath : null);

    if (mirrorPath) {
      const upstream = new URL(PUBLIC_MIRROR_ORIGIN + mirrorPath + url.search);
      const response = await fetch(upstream.toString(), {
        headers: { 'cache-control': 'no-cache', accept: '*/*' },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return Response.json({ ok:false, error:'public_surface_unavailable', path:normalizedPath }, {
          status: response.status,
          headers: { 'cache-control':'no-store' },
        });
      }

      const headers = new Headers(response.headers);
      headers.set('x-zpc-canonical-origin', CANONICAL_PUBLIC_ORIGIN);
      headers.set('x-zpc-upstream-role', 'internal-public-mirror');

      const contentType = String(headers.get('content-type') || '');
      if (contentType.includes('text/html')) {
        let html = await response.text();
        const rewrites: Array<[string,string]> = [
          ['https://zevanory.api.br', CANONICAL_PUBLIC_ORIGIN],
          ['/zevanory-public-mirror/solucoes', '/solucoes'],
          ['/zevanory-public-mirror/termos', '/termos'],
          ['/zevanory-public-mirror/privacidade', '/privacidade'],
          ['/zevanory-public-mirror/reembolso', '/reembolso'],
          ['/zevanory-public-mirror/zevanory-one', '/produtos/zevanory-one'],
          ['/zevanory-public-mirror/arbm-contador-saloes', '/produtos/arbm-contador-saloes'],
          ['/zevanory-public-mirror/arbm-sist', '/produtos/arbm-sist'],
          ['/zevanory-public-mirror/ia-na-pratica', '/produtos/ia-na-pratica'],
          ['/zevanory-public-mirror/vendas-na-pratica', '/produtos/vendas-na-pratica'],
          ['/zevanory-public-mirror/lucro-e-caixa', '/produtos/lucro-e-caixa'],
          ['/zevanory-public-mirror/combo-ia-vendas', '/produtos/combo-ia-vendas'],
          ['/zevanory-public-mirror/negocio-completo', '/produtos/negocio-completo'],
          ['/zevanory-public-mirror/brand/', '/brand/'],
          ['/zevanory-public-mirror/product.css', '/assets/product.css'],
          ['/zevanory-public-mirror/', '/solucoes'],
        ];
        for (const [from,to] of rewrites) html = html.split(from).join(to);
        headers.set('content-type','text/html; charset=utf-8');
        headers.set('cache-control','public, max-age=60');
        return new Response(html,{status:response.status,headers});
      }

      headers.set('cache-control','public, max-age=3600');
      return new Response(response.body,{status:response.status,headers});
    }

    if (normalizedPath === '/version.json') {
      return Response.json({
        sha: String(env.WORKER_COMMIT || 'untracked'),
        runtime: 'cloudflare-worker',
        host: url.hostname,
      }, {
        headers: { 'cache-control': 'no-store, max-age=0' },
      });
    }

    if (normalizedPath === '/portable-health') {
      const health = await portableHealth();
      const lineage = String(env.WORKER_COMMIT || 'untracked');
      return Response.json({ ...health, runtime: 'cloudflare-worker', backendSourceSha: lineage, workerCommit: lineage }, {
        status: health.ok ? 200 : 503,
        headers: { 'cache-control': 'no-store' },
      });
    }

    if (normalizedPath === '/runtime-proof') {
      const lineage = String(env.WORKER_COMMIT || 'untracked');
      return Response.json({ ok: true, runtime: 'cloudflare-worker', backendSourceSha: lineage, workerCommit: lineage, directBackend: true }, {
        headers: { 'cache-control': 'no-store' },
      });
    }

    if (normalizedPath === '/definir-pin' || normalizedPath === '/__complete-pin-migration') {
      return Response.json(
        { ok: false, error: 'migration_closed' },
        { status: 410, headers: { 'cache-control': 'no-store, max-age=0' } },
      );
    }

    if (normalizedPath === '/api/pin/login') {
      // Per-IP throttle (Cloudflare rate-limit binding, free): 5 attempts/minute per address, on top
      // of the global progressive lock inside pinLogin.
      const limiter = (env as any).PIN_LIMITER;
      if (limiter?.limit) {
        const ip = request.headers.get('cf-connecting-ip') || 'unknown';
        try {
          const { success } = await limiter.limit({ key: 'pin:' + ip });
          if (!success) return Response.json({ ok: false, error: 'Muitas tentativas. Aguarde um minuto.' }, { status: 429, headers: { 'cache-control': 'no-store', 'retry-after': '60' } });
        } catch {}
      }
    }

    if (normalizedPath === '/api/commercial/funnel' && request.method === 'POST') {
      // Funnel + paid-ads readiness from the hourly summary published by the main Worker.
      let token = '';
      try { token = String((await request.clone().json() as any)?.sessionToken || ''); } catch {}
      if (!token || !(await verifyEdgeSession(token))) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
      let summary: any = null;
      try { summary = JSON.parse(String(await (env as any).T2_CREATIVE_ASSETS?.get?.('zpc-funnel:v1:summary') || 'null')); } catch {}
      return Response.json({ ok: true, summary, readiness: assessAdsReadiness(summary), policy: ADS_POLICY }, { headers: { 'cache-control': 'no-store' } });
    }

    if (normalizedPath === '/api/sales/state' && request.method === 'GET') {
      // Mirror the established owner-switch status without mutating KV or inferring a state.
      const kv = (env as any).T2_CREATIVE_ASSETS;
      try {
        if (!kv?.get) throw new Error('kv_unavailable');
        const [switchRaw, preflightRaw] = await Promise.all([kv.get('sales:open:v1'), kv.get('zpc-sales-preflight:v1')]);
        const sw = switchRaw ? JSON.parse(String(switchRaw)) : null;
        const preflight = preflightRaw ? JSON.parse(String(preflightRaw)) : null;
        const fresh = Boolean(preflight?.at) && Number.isFinite(Date.parse(String(preflight.at))) && Date.now() - Date.parse(String(preflight.at)) < 3 * 3600 * 1000;
        if (typeof sw?.enabled !== 'boolean' || typeof preflight?.ok !== 'boolean' || !fresh) throw new Error('state_unverified');
        const open = sw.enabled === true && preflight.ok === true;
        return Response.json({ ok: true, state: open ? 'open' : 'closed', open }, { headers: { 'cache-control': 'no-store' } });
      } catch {
        return Response.json({ ok: false, error: 'state_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } });
      }
    }

    if ((normalizedPath === '/api/sales/state' || normalizedPath === '/api/sales/switch') && request.method === 'POST') {
      // Owner's open/close sales switch. Opening requires a fresh green production preflight
      // (computed hourly by the main Worker); the main Worker re-checks it on every request.
      let body: any = {};
      try { body = await request.clone().json(); } catch {}
      const token = String(body?.sessionToken || '');
      if (!token || !(await verifyEdgeSession(token))) return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: { 'cache-control': 'no-store' } });
      const kv = (env as any).T2_CREATIVE_ASSETS;
      const read = async (key: string) => { try { return JSON.parse(String(await kv?.get?.(key) || 'null')); } catch { return null; } };
      const preflight = await read('zpc-sales-preflight:v1');
      const fresh = Boolean(preflight?.at) && Date.now() - Date.parse(String(preflight.at)) < 3 * 3600 * 1000;
      if (normalizedPath === '/api/sales/switch') {
        const open = body?.open === true;
        if (open && !(preflight?.ok === true && fresh)) {
          return Response.json({ ok: false, error: 'preflight_not_green', preflight }, { status: 409, headers: { 'cache-control': 'no-store' } });
        }
        await kv.put('sales:open:v1', JSON.stringify({ enabled: open, at: new Date().toISOString(), by: 'owner-panel' }));
        await recordCommercialActivity(env as Record<string, any>, 'event', {
          title: open ? 'Vendas ABERTAS pelo dono' : 'Vendas FECHADAS pelo dono',
          detail: open ? 'Checkout real liberado nas páginas de venda (Mercado Pago produção).' : 'Botão de compra volta a mostrar "vendas abrem em breve". Pedidos já pagos continuam sendo entregues.',
          status: open ? 'active' : 'blocked',
          channel: 'checkout',
          sourceKey: 'sales-switch:' + Date.now(),
          evidence: ['owner-panel', new Date().toISOString()],
        });
      }
      const sw = await read('sales:open:v1');
      return Response.json({ ok: true, requested: sw?.enabled === true, open: sw?.enabled === true && preflight?.ok === true && fresh, switchedAt: sw?.at || null, preflight, preflightFresh: fresh }, { headers: { 'cache-control': 'no-store' } });
    }

    if (normalizedPath.startsWith('/api/')) {
      const edgeAuthPath = normalizedPath === '/api/_auth_diagnostic' || normalizedPath === '/api/_session_verify' || normalizedPath === '/api/pin/login' || normalizedPath === '/api/pin/logout';
      const forceDirect = edgeAuthPath || url.searchParams.get('runtime') === 'cloudflare';
      const renderBase = forceDirect ? '' : String(env.RENDER_BACKEND_URL || '').replace(/\/$/, '');
      if (renderBase && normalizedPath === '/api/admin/bootstrap' && request.method === 'POST') {
        const fast = await edgeBootstrap(normalizedRequest, env as Record<string, any>, ctx, renderBase).catch(() => null);
        if (fast) return fast;
      }
      // A successful authenticated mutation invalidates the edge snapshot (anonymous or failed
      // requests never touch it).
      const mutating = request.method !== 'GET' && request.method !== 'HEAD' && !BOOTSTRAP_READ_ONLY.has(normalizedPath);
      const invalidate = async (response: Response) => {
        if (mutating && response.status < 400) {
          try { await (env as any).T2_CREATIVE_ASSETS?.delete?.(BOOTSTRAP_SNAPSHOT_KEY); } catch {}
        }
        return response;
      };
      if (renderBase) {
        const sessionGuard = await guardProxiedEdgeSession(request);
        if (sessionGuard) return sessionGuard;
        try {
          const target = renderBase + normalizedPath + url.search;
          const primaryResponse = await fetch(new Request(target, normalizedRequest.clone()));
          if (primaryResponse.status < 500) return invalidate(primaryResponse);
        } catch {}
      }
      return invalidate(await handler(normalizedRequest));
    }

    // Trust/lineage files are generated by the canonical Pages build and must never be shadowed
    // by the immutable ASSETS bundle from an older Worker deployment.
    if (normalizedPath === '/global-trust.json' || normalizedPath === '/zpc-build.json') {
      try {
        const pagesResponse = await fetchPagesOrigin(normalizedPath);
        if (pagesResponse) return pagesResponse;
      } catch {}
    }

    if (env.ASSETS && typeof (env.ASSETS as any).fetch === 'function') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = normalizedPath === '/' ? '/' : normalizedPath;
      const assetResponse = await (env.ASSETS as any).fetch(new Request(assetUrl.toString(), request));
      if (assetResponse.status !== 404) {
        const headers = new Headers(assetResponse.headers);
        if (String(headers.get('content-type') || '').includes('text/html')) {
          headers.set('cache-control', 'no-store, max-age=0');
        }
        headers.set('x-zpc-ui-origin', 'cloudflare-assets');
        applyPanelSecurityHeaders(headers);
        return new Response(assetResponse.body, { status: assetResponse.status, headers });
      }
      const spaResponse = await (env.ASSETS as any).fetch(new Request(new URL('/', request.url).toString(), request));
      if (spaResponse.status !== 404) {
        const headers = new Headers(spaResponse.headers);
        headers.set('cache-control', 'no-store, max-age=0');
        headers.set('x-zpc-ui-origin', 'cloudflare-assets');
        applyPanelSecurityHeaders(headers);
        return new Response(spaResponse.body, { status: spaResponse.status, headers });
      }
    }

    try {
      const pagesResponse = await fetchPagesOrigin(normalizedPath);
      if (pagesResponse) return pagesResponse;
    } catch {}

    return handler(normalizedRequest);
  },
};
