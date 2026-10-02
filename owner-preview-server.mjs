import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_SHA='d603f0000bd32e0d1f24b6b7680e8dd0692f2a7e';
const PORT=Number(process.env.PORT||10000);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'dist');
const now='2026-10-02T12:50:00-03:00';

const pillars=Array.from({length:16},(_,i)=>({
  id:`P${String(i+1).padStart(2,'0')}`,
  name:[
    'Produto & Arquitetura','UI/UX & Design System','Tipografia, Cores & Geometria','Acessibilidade',
    'Engenharia de Código','Testes & Regressão','Segurança de Aplicação','Supply Chain & Dependências',
    'Privacidade & Compliance','Infraestrutura & Disaster Recovery','Performance & Escalabilidade',
    'Observabilidade & Operação','Dados & Governança de Dados','IA, LLMOps & Agentes',
    'CI/CD, Release & Proveniência','Comercial, Entrega & Ciclo de Vida'
  ][i],
  shortName:`P${String(i+1).padStart(2,'0')}`,
  status:i<12?'proved':i<14?'partial':'blocked',
  controls:8,
  rationale:'Conteúdo mock de validação visual do PR #116. A altura é definida pelo conteúdo, sem corte ou sobreposição.',
  blocker:i<14?null:'preview_blocker_long_identifier_1234567890abcdef_sem_corte',
  evidence:i<12?['preview:owner-validation','source:d603f000']:[],
}));
const certification={
  standard:'ZEES-16',version:'ZEES-16 v1',profile:'SAAS_TRANSACTIONAL',ready:false,
  rootBlocker:'preview_payment_provider_reconciliation_pending_1234567890abcdef',
  evidenceCount:24,
  summary:{proved:12,partial:2,blocked:2,na:0,external:0,applicable:16,applicableControls:128,provedControls:96},
  pillars
};
const products=[
  {
    id:'preview-product-1',name:'ZEVANORY ONE — Gestão Comercial Integrada',slug:'zevanory-one-preview',
    category:'Software / SaaS transacional',description:'Produto mock com descrição extensa para validar altura natural, wrapping, ações e ausência de clipping em todos os tamanhos.',
    publicUrl:'https://zevanory.api.br/',priceCents:119700,currency:'BRL',checkoutUrl:'',deliveryModel:'Implantação digital assistida',
    channels:['Site','Instagram','WhatsApp'],status:'validation',salesEnabled:false,
    gates:{legal:true,payment:false,fulfillment:true,support:true},
    audit:{engineering:9.4,infrastructure:9.1,ux:8.8,observability:9.3,lastAuditedAt:now},
    auditOverall:9.15,auditStatus:'audited',notes:'Mock somente para validação visual.',createdAt:now,updatedAt:now,
    commercialReady:false,blockers:['Reconciliação financeira pendente com identificador_extremamente_longo_1234567890abcdef'],certification
  },
  {
    id:'preview-product-2',name:'IA na Prática',slug:'ia-na-pratica',category:'Conteúdo digital',
    description:'Curso mock para validação da grade de produtos.',publicUrl:'https://zevanory.api.br/',priceCents:19990,currency:'BRL',
    checkoutUrl:'',deliveryModel:'Digital',channels:['Site'],status:'ready',salesEnabled:false,
    gates:{legal:true,payment:true,fulfillment:true,support:true},
    audit:{engineering:9.2,infrastructure:9.0,ux:9.1,observability:9.0,lastAuditedAt:now},
    auditOverall:9.075,auditStatus:'audited',notes:'',createdAt:now,updatedAt:now,commercialReady:false,
    blockers:['global_sale_disabled'],certification
  },
  {
    id:'preview-product-3',name:'Vendas na Prática',slug:'vendas-na-pratica',category:'Conteúdo digital',
    description:'Curso mock para validação responsiva.',publicUrl:'https://zevanory.api.br/',priceCents:19990,currency:'BRL',
    checkoutUrl:'',deliveryModel:'Digital',channels:['Site'],status:'draft',salesEnabled:false,
    gates:{legal:false,payment:false,fulfillment:true,support:true},
    audit:{engineering:null,infrastructure:null,ux:null,observability:null,lastAuditedAt:null},
    auditOverall:null,auditStatus:'pending',notes:'',createdAt:now,updatedAt:now,commercialReady:false,
    blockers:['legal_gate_pending','payment_gate_pending'],certification
  }
];
const record=(id,kind,title,status,extra={})=>({
  id,kind,title,detail:extra.detail||'Registro mock para inspeção visual.',status,
  channel:extra.channel||null,product:extra.product||'ZEVANORY',productId:null,valueCents:extra.valueCents??null,
  source:'owner-preview',sourceKey:id,evidence:['owner-preview','source:d603f000'],createdAt:now,updatedAt:now,publishedAt:extra.publishedAt||null
});
const commercial={
  generatedAt:now,tenant:{id:'preview',defaultTenant:false,tenantSource:'owner-preview',isolation:'mock',clientSelectable:false},
  metrics:{leadsToday:16,contactsToday:4,creativesInProduction:3,pendingApproval:2,publishedToday:1,salesCentsToday:129900},
  robot:{state:'ACTIVE',label:'ROBÔ COMERCIAL: PREVIEW',reason:'Dados mock; nenhuma ação externa.',lastHeartbeatAt:now,externalProspecting:false,publishAdapterReady:false,activeChannels:['mock']},
  leads:[record('lead-1','lead','Lead mock com título longo para validação','new',{channel:'mock'})],
  creatives:[
    record('creative-1','creative','Criativo mock principal','approval',{detail:'Texto deliberadamente longo para validar o creativeLiveBody sem altura fixa e sem esconder evidência.'}),
    record('creative-2','creative','Criativo mock secundário','draft',{detail:'Segundo criativo para validar grade e wrapping em claro e escuro.'})
  ],
  publications:[record('publication-1','publication','Publicação mock','published',{channel:'mock',publishedAt:now})],
  events:[record('event-1','event','Evento mock','research')],
  support:[record('support-1','support','Atendimento mock','resolved')],
  finance:[record('finance-1','finance','Receita mock','confirmed',{valueCents:129900})],
  evidence:[record('evidence-1','evidence','Evidência visual mock','confirmed')],
  counts:{leads:1,creatives:2,publications:1,events:1,support:1,finance:1,evidence:1}
};
const dashboard={
  systems:[
    {id:'sys-1',name:'ZEVANORY',domain:'zevanory.api.br',status:'healthy',score:98,lastAudit:now,gate:'GREEN',evidence:['preview visual'],sha:'d603f000',source:'mock',availability:100,latencyMs:84,ci:'PASS'},
    {id:'sys-2',name:'Control Center Preview',domain:'preview.local',status:'healthy',score:100,lastAudit:now,gate:'OWNER REVIEW',evidence:['mock only'],sha:'d603f000',source:'mock',availability:100,latencyMs:1,ci:'PASS'}
  ],
  audits:[
    {id:'audit-1',system:'ZEVANORY',severity:'info',title:'Runtime visual 124/124',detail:'Evidência mock apresentada apenas para navegação visual.',createdAt:now},
    {id:'audit-2',system:'ZEVANORY',severity:'warning',title:'Item longo de auditoria',detail:'Texto longo para validar a fila operacional sem clipping nem sobreposição.',createdAt:now}
  ],
  improvements:[{id:'imp-1',system:'ZEVANORY',priority:'P1',title:'Validação visual do proprietário',reason:'Revisão humana antes do merge.',state:'validated'}],
  incidents:[
    {id:'inc-1',system:'Preview',severity:'warning',title:'Incidente mock de comprimento propositalmente grande',detail:'Não é incidente real. Existe somente para testar altura natural da linha operacional.',createdAt:now,state:'watching'}
  ],
  policy:{zeroSpend:true,failClosed:true,destructiveActions:false,greenRule:'Somente evidência reproduzível'},
  lastEngineRun:now,
  certificationRuns:[{id:'run-1',targetId:'product:preview-product-1',targetName:'ZEVANORY ONE — Gestão Comercial Integrada',status:'complete',releaseFingerprint:'preview-d603f000',sourceSha:SOURCE_SHA,startedAt:now,finishedAt:now,completedPillars:16,currentPillar:null}]
};
const bootstrap={
  dashboard,
  globalTrust:{state:'GREEN',sha:SOURCE_SHA,evidenceRoot:'owner-preview',policyVersion:'PED-VERSAL-V1.1-SUPREME',quorum:{passed:3,total:3,required:3,conflicts:0,independentKeys:3},zea10:{proven:10,partial:0,blocked:0},engines:[],checkedAt:now},
  operations:{available:true,generatedAt:now,releaseSha:SOURCE_SHA,health:{ready:true,live:true,databaseReachable:false,schemaReady:true,requiredTables:1,requiredMigrations:1,missingTables:0,missingMigrations:0},runtime:{sales:'mock-blocked',checkout:'blocked',financial:'mock',whatsapp:'blocked'},control:{globalState:'OWNER_PREVIEW',rootBlocker:'preview_only',decision:'BLOCK'},continuity:{quorumOk:true,mode:'mock-no-external-data',channels:['mock'],whatsappDependencyRequired:false},channels:[{name:'mock',scopeStatus:'ready',releaseGate:'owner-review',commercialExecution:'blocked'}],zees16:{proven:16,partial:0,blocked:0},zea10:{proven:10,partial:0,blocked:0,unknown:0}},
  commercial,cfo:null,products,
  certificationTargets:products.map(p=>({id:`product:${p.id}`,name:p.name,kind:'PRODUTO',publicUrl:p.publicUrl,certification:p.certification})),
  summary:{total:products.length,salesEnabled:0,commercialReady:0,blocked:products.length,certified:0,inCertification:products.length,zeesBlocked:products.length}
};

const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.woff2':'font/woff2'};
const json=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));};
const safePath=urlPath=>{
  const rel=decodeURIComponent(urlPath).replace(/^\/+/, '');
  const resolved=path.resolve(root,rel||'index.html');
  return resolved.startsWith(root)?resolved:null;
};
async function serveStatic(req,res,url){
  let file=safePath(url.pathname);
  if(!file){res.writeHead(400);res.end('bad path');return;}
  try{
    const info=await stat(file);
    if(info.isDirectory()) file=path.join(file,'index.html');
  }catch{
    if(!path.extname(file)) file=path.join(root,'index.html');
  }
  try{
    let body=await readFile(file);
    if(path.extname(file)==='.html'){
      let html=body.toString('utf8');
      html=html.replace('</head>',`<script>localStorage.setItem('arbm_admin_session','owner-preview-session');</script></head>`);
      body=Buffer.from(html);
    }
    res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store','x-owner-preview-source-sha':SOURCE_SHA});
    res.end(body);
  }catch{
    res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('not found');
  }
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/version.json') return json(res,200,{mode:'OWNER_PREVIEW_MOCK',source_sha:SOURCE_SHA,harness_sha:process.env.RENDER_GIT_COMMIT||null,supabase:false,production:false});
  if(req.method==='GET'&&url.pathname==='/global-trust.json') return json(res,200,bootstrap.globalTrust);
  if(req.method==='POST'&&(url.pathname==='/api/_session_verify'||url.pathname==='/control/api/_session_verify')) return json(res,200,{valid:true});
  if(req.method==='POST'&&(url.pathname==='/api/admin/bootstrap'||url.pathname==='/control/api/admin/bootstrap')) return json(res,200,bootstrap);
  if(req.method==='POST'&&(url.pathname==='/api/pin/login'||url.pathname==='/control/api/pin/login')) return json(res,200,{ok:true,sessionToken:'owner-preview-session',expiresAt:'2099-01-01T00:00:00.000Z'});
  if(req.method==='POST'&&url.pathname.startsWith('/api/')) return json(res,200,{ok:true,preview:true,mutated:false,message:'OWNER_PREVIEW_MOCK: nenhuma ação persistida'});
  if(req.method==='GET'&&(url.pathname==='/api/commercial/stream'||url.pathname==='/control/api/commercial/stream')){
    res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','connection':'keep-alive'});
    res.end(`event: commercial-update\ndata: {"seq":1,"at":"${now}"}\n\n`);
    return;
  }
  return serveStatic(req,res,url);
});
server.listen(PORT,'0.0.0.0',()=>console.log(JSON.stringify({owner_preview:'ready',port:PORT,source_sha:SOURCE_SHA,supabase:false,production:false})));
